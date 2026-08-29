import crypto from "node:crypto";
import { ErrorCode } from "@shared/types/errors";
import type { PluginQuality } from "@shared/types/plugin";
import type { Track } from "@shared/types/player";
import { buildPluginPlaybackMusicInfo, pluginPlaybackSource } from "@shared/utils/pluginPlayback";
import { playbackSourceCacheKey } from "@main/services/playbackSourcePolicy";
import { callNetease } from "@main/apis/netease";
import { callQobuz } from "@main/apis/qobuz";
import { callTidal } from "@main/apis/tidal";
import { store } from "@main/store";
import * as songCache from "@main/services/songCache";
import { withStreamingAdapter } from "@main/services/streaming/connection";
import { pluginRegistry } from "@main/plugins/registry";
import { resolveUrl as resolvePluginUrl } from "@main/plugins/router";

const NETEASE_LEVEL: Record<PluginQuality, string> = {
  lq: "standard",
  sq: "higher",
  hq: "exhigh",
  lossless: "lossless",
  "hi-res": "hires",
};

const QOBUZ_FORMAT_ID: Record<PluginQuality, string> = {
  "hi-res": "27",
  lossless: "6",
  hq: "6",
  sq: "5",
  lq: "5",
};

const TIDAL_QUALITY: Record<PluginQuality, string> = {
  "hi-res": "HI_RES_LOSSLESS",
  lossless: "LOSSLESS",
  hq: "HIGH",
  sq: "HIGH",
  lq: "LOW",
};

export interface ResolvedPlaybackSource {
  source: string;
  provider: "local" | "cache" | "streaming" | "official" | "plugin" | "trial";
  cacheAfterLoad?: () => Promise<string | null>;
}

export interface ResolvedDownloadSource {
  source: string;
  format?: string;
  size?: number;
}

export class PlaybackSourceError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PlaybackSourceError";
  }
}

const sourceError = (code: ErrorCode, message: string, cause?: unknown): PlaybackSourceError =>
  new PlaybackSourceError(code, message, cause === undefined ? undefined : { cause });

/** 将 provider/网络异常收敛为 Core playback ErrorCode。 */
export const playbackSourceErrorCode = (error: unknown): ErrorCode => {
  if (error instanceof PlaybackSourceError) return error.code;
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|ETIMEDOUT|AbortError/i.test(message)) return ErrorCode.NETWORK_TIMEOUT;
  if (/fetch|network|ECONN|ENOTFOUND|EHOST|socket/i.test(message)) return ErrorCode.NETWORK_ERROR;
  return ErrorCode.URL_RESOLVE_FAILED;
};

const cacheEnabled = (track: Track, cacheKey: string | null): boolean => {
  if (!cacheKey || store.get("cache.songCache.enabled") !== true) return false;
  if (track.source === "streaming") return store.get("cache.songCache.cacheStreaming") === true;
  return true;
};

const cacheResult = async (
  track: Track,
  cacheKey: string | null,
): Promise<ResolvedPlaybackSource | null> => {
  if (!cacheEnabled(track, cacheKey) || !cacheKey) return null;
  const cached = await songCache.lookup(cacheKey);
  return cached ? { source: cached, provider: "cache" } : null;
};

const cacheAfterLoad = (
  track: Track,
  cacheKey: string | null,
  source: string,
): (() => Promise<string | null>) | undefined => {
  if (!cacheEnabled(track, cacheKey) || !cacheKey || !/^https?:\/\//i.test(source))
    return undefined;
  return () => songCache.fetchAsync(cacheKey, track.source, source);
};

const resolveStreaming = async (
  track: Track,
  cacheKey: string | null,
): Promise<ResolvedPlaybackSource> => {
  if (!track.serverId) {
    throw sourceError(
      ErrorCode.URL_RESOLVE_FAILED,
      `Streaming track missing serverId: ${track.id}`,
    );
  }
  const remoteId = track.originalId || track.id;
  const source = await withStreamingAdapter(track.serverId, (config, adapter) =>
    adapter.getStreamUrl(config, remoteId, crypto.randomUUID()),
  );
  return {
    source,
    provider: "streaming",
    cacheAfterLoad:
      cacheEnabled(track, cacheKey) && cacheKey
        ? async () => {
            const cacheSource = await withStreamingAdapter(track.serverId!, (config, adapter) =>
              adapter.getStreamUrl(config, remoteId, crypto.randomUUID()),
            );
            return songCache.fetchAsync(cacheKey, "streaming", cacheSource);
          }
        : undefined,
  };
};

const resolvePluginCompatibility = async (
  track: Track,
  quality: PluginQuality,
  cacheKey: string | null,
): Promise<ResolvedPlaybackSource> => {
  const pluginSource = pluginPlaybackSource(track.source);
  if (!pluginSource) {
    throw sourceError(
      ErrorCode.NO_PLUGIN_AVAILABLE,
      `No inherited plugin source mapping for ${track.source}`,
    );
  }
  const candidates = pluginRegistry
    .listInfo()
    .filter(
      (info) =>
        info.enabled &&
        info.status.state === "ready" &&
        info.status.sources[pluginSource]?.actions.includes("musicUrl"),
    );
  if (candidates.length === 0) {
    throw sourceError(
      ErrorCode.NO_PLUGIN_AVAILABLE,
      `No ready musicUrl plugin for inherited ${track.source} track: ${track.id}`,
    );
  }

  const musicInfo = buildPluginPlaybackMusicInfo(track, pluginSource);
  for (const plugin of candidates) {
    try {
      const resolved = await resolvePluginUrl({
        pluginId: plugin.manifest.id,
        source: pluginSource,
        quality,
        musicInfo,
      });
      if (!resolved.url) continue;
      return {
        source: resolved.url,
        provider: "plugin",
        cacheAfterLoad: cacheAfterLoad(track, cacheKey, resolved.url),
      };
    } catch {
      // 兼容上游多插件兜底：单插件失败不阻止尝试下一候选。
      continue;
    }
  }
  throw sourceError(
    ErrorCode.URL_RESOLVE_FAILED,
    `Inherited plugin source failed for ${track.source} track: ${track.id}`,
  );
};

const resolveNetease = async (
  track: Track,
  quality: PluginQuality,
  cacheKey: string | null,
): Promise<ResolvedPlaybackSource> => {
  let response;
  try {
    response = await callNetease("song_url", {
      id: track.id,
      level: NETEASE_LEVEL[quality],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/401|403|auth|cookie|login/i.test(message)) {
      throw sourceError(
        ErrorCode.NETEASE_LOGIN_EXPIRED,
        `Netease login expired: ${track.id}`,
        error,
      );
    }
    throw error;
  }
  const item = (response.body as { data?: unknown[] } | undefined)?.data?.[0] as
    { url?: unknown; freeTrialInfo?: unknown; fee?: unknown } | undefined;
  const source = typeof item?.url === "string" ? item.url : "";
  if (!source) {
    const fee = Number(item?.fee ?? track.fee);
    if (fee === 1 || fee === 4) {
      throw sourceError(
        ErrorCode.NETEASE_VIP_REQUIRED,
        `Netease track requires entitlement: ${track.id}`,
      );
    }
    throw sourceError(ErrorCode.NETEASE_UNAVAILABLE, `Netease track unavailable: ${track.id}`);
  }
  const isTrial = item?.freeTrialInfo != null;
  if (isTrial && store.get("player.allowTrialPlay") !== true) {
    throw sourceError(ErrorCode.NETEASE_TRIAL_DISABLED, `Netease trial disabled: ${track.id}`);
  }
  return {
    source,
    provider: isTrial ? "trial" : "official",
    cacheAfterLoad: isTrial ? undefined : cacheAfterLoad(track, cacheKey, source),
  };
};

const resolveNeteaseDownload = async (
  track: Track,
  quality: PluginQuality,
  usePlaybackForDownload: boolean,
): Promise<ResolvedDownloadSource | null> => {
  const level = NETEASE_LEVEL[quality];
  if (!usePlaybackForDownload) {
    try {
      const response = await callNetease("song_download_url", { id: track.id, level });
      const item = (response.body as { data?: unknown } | undefined)?.data as
        { url?: unknown; type?: unknown; size?: unknown } | undefined;
      if (typeof item?.url === "string" && item.url) {
        return {
          source: item.url,
          format: typeof item.type === "string" ? item.type : undefined,
          size: typeof item.size === "number" ? item.size : undefined,
        };
      }
    } catch {
      // 与现有下载行为一致：官方下载失败后继续尝试播放地址。
    }
  }

  try {
    const response = await callNetease("song_url", { id: track.id, level });
    const item = (response.body as { data?: unknown[] } | undefined)?.data?.[0] as
      { url?: unknown; type?: unknown; size?: unknown; freeTrialInfo?: unknown } | undefined;
    if (typeof item?.url !== "string" || !item.url || item.freeTrialInfo != null) return null;
    return {
      source: item.url,
      format: typeof item.type === "string" ? item.type : undefined,
      size: typeof item.size === "number" ? item.size : undefined,
    };
  } catch {
    return null;
  }
};

const resolveNeteaseWithPluginFallback = async (
  track: Track,
  quality: PluginQuality,
  cacheKey: string | null,
): Promise<ResolvedPlaybackSource> => {
  let officialError: unknown = null;
  let trial: ResolvedPlaybackSource | null = null;
  try {
    const official = await resolveNetease(track, quality, cacheKey);
    if (official.provider !== "trial") return official;
    trial = official;
  } catch (error) {
    officialError = error;
  }

  try {
    return await resolvePluginCompatibility(track, quality, cacheKey);
  } catch (pluginError) {
    if (trial) return trial;
    if (officialError) throw officialError;
    throw pluginError;
  }
};

const resolveQobuz = async (
  track: Track,
  quality: PluginQuality,
  cacheKey: string | null,
): Promise<ResolvedPlaybackSource> => {
  const resolved = (await callQobuz("track_getFileUrl", {
    track_id: track.id,
    format_id: QOBUZ_FORMAT_ID[quality],
  })) as { url?: string; sample?: boolean };
  if (!resolved.url || resolved.sample) {
    throw sourceError(ErrorCode.URL_RESOLVE_FAILED, `Qobuz track unavailable: ${track.id}`);
  }
  return {
    source: resolved.url,
    provider: "official",
    cacheAfterLoad: cacheAfterLoad(track, cacheKey, resolved.url),
  };
};

const resolveTidal = async (
  track: Track,
  quality: PluginQuality,
  cacheKey: string | null,
): Promise<ResolvedPlaybackSource> => {
  const resolved = (await callTidal("track_getStreamUrl", {
    track_id: track.id,
    quality: TIDAL_QUALITY[quality],
  })) as { streamUrl?: string; localPath?: string };
  if (resolved.localPath) return { source: resolved.localPath, provider: "official" };
  if (!resolved.streamUrl) {
    throw sourceError(ErrorCode.URL_RESOLVE_FAILED, `TIDAL track unavailable: ${track.id}`);
  }
  return {
    source: resolved.streamUrl,
    provider: "official",
    cacheAfterLoad: cacheAfterLoad(track, cacheKey, resolved.streamUrl),
  };
};

/**
 * 为 Core 下载任务解析指定音质的源；任务只保存 canonical Track，不依赖 Control 回传临时 URL。
 * @param track - 下载歌曲
 * @param quality - 下载音质
 * @param usePlaybackForDownload - 网易是否只使用播放地址避免占用下载次数
 * @returns 当前可用下载输入
 */
export const resolveDownloadSource = async (
  track: Track,
  quality: PluginQuality,
  usePlaybackForDownload: boolean,
): Promise<ResolvedDownloadSource> => {
  if (track.source === "local") {
    throw sourceError(
      ErrorCode.FILE_NOT_FOUND,
      `Local track is not a download source: ${track.id}`,
    );
  }
  if (track.source === "streaming") {
    return { source: (await resolveStreaming(track, null)).source };
  }
  if (track.source === "netease") {
    const official = await resolveNeteaseDownload(track, quality, usePlaybackForDownload);
    if (official) return official;
    return { source: (await resolvePluginCompatibility(track, quality, null)).source };
  }
  if (track.source === "qobuz") {
    return { source: (await resolveQobuz(track, quality, null)).source };
  }
  if (track.source === "tidal") {
    return { source: (await resolveTidal(track, quality, null)).source };
  }
  if (track.source === "qqmusic" || track.source === "kugou") {
    return { source: (await resolvePluginCompatibility(track, quality, null)).source };
  }
  throw sourceError(ErrorCode.NO_PLUGIN_AVAILABLE, `No Core download resolver for ${track.source}`);
};

/**
 * 从 canonical Track 解析当前时刻可播放输入。
 * Core 持有音质、试听、缓存与 provider session 权威；Control 不下发最终 URL。
 */
export const resolvePlaybackSource = async (track: Track): Promise<ResolvedPlaybackSource> => {
  if (track.source === "local") {
    const source = track.cueAudioPath ?? track.path;
    if (!source) {
      throw sourceError(ErrorCode.FILE_NOT_FOUND, `Local track has no playable path: ${track.id}`);
    }
    return { source, provider: "local" };
  }

  const quality = store.get("player.songLevel");
  const cacheKey = playbackSourceCacheKey(track, quality);
  const cached = await cacheResult(track, cacheKey);
  if (cached) return cached;

  if (track.source === "streaming") return resolveStreaming(track, cacheKey);
  if (track.source === "netease") return resolveNeteaseWithPluginFallback(track, quality, cacheKey);
  if (track.source === "qobuz") return resolveQobuz(track, quality, cacheKey);
  if (track.source === "tidal") return resolveTidal(track, quality, cacheKey);
  if (track.source === "qqmusic" || track.source === "kugou") {
    return resolvePluginCompatibility(track, quality, cacheKey);
  }

  throw sourceError(ErrorCode.NO_PLUGIN_AVAILABLE, `No Core source resolver for ${track.source}`);
};
