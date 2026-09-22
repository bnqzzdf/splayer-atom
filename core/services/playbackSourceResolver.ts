import crypto from "node:crypto";
import { ErrorCode } from "@shared/types/errors";
import type { PluginQuality } from "@shared/types/plugin";
import type { Track } from "@shared/types/player";
import { buildPluginPlaybackMusicInfo, pluginPlaybackSource } from "@shared/utils/pluginPlayback";
import {
  classifyPluginFailureMessage,
  neteaseUnavailableErrorCode,
  playbackSourceCacheKey,
  pluginUnavailableErrorCode,
} from "@main/services/playbackSourcePolicy";
import { callNetease } from "@main/apis/netease";
import { callQQMusic } from "@main/apis/qqmusic";
import { callKugou } from "@main/apis/kugou";
import { getProviderSessions } from "@main/services/providerApi";
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
  /** Provider 返回的容器/编码提示；下载路径可据此选择扩展名。 */
  format?: string;
  /** Provider 返回的已知字节数。 */
  size?: number;
  cacheAfterLoad?: (materializedSource?: string) => Promise<string | null>;
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
  // 输出侧格式约束要单独识别：它既不是网络问题也不是解析问题，
  // 归到 NETWORK_ERROR 会让用户去查网络，完全误导。
  if (
    /strict Source Direct|只接受 lossless integer PCM|PCM wire format 与当前 Diretta connection 不一致/i.test(
      message,
    )
  ) {
    return ErrorCode.OUTPUT_FORMAT_UNSUPPORTED;
  }
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
): ((materializedSource?: string) => Promise<string | null>) | undefined => {
  if (!cacheEnabled(track, cacheKey) || !cacheKey || !/^https?:\/\//i.test(source))
    return undefined;
  return (materializedSource) =>
    materializedSource
      ? songCache.importFileAsync(cacheKey, track.source, materializedSource)
      : songCache.fetchAsync(cacheKey, track.source, source);
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
        ? async (materializedSource?: string) => {
            if (materializedSource) {
              return songCache.importFileAsync(cacheKey, "streaming", materializedSource);
            }
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
  // 多插件兜底期间记录「最强」的失败信号：结构化 reason 优先于文案归类。
  // 只为一件事——让用户看到「需要会员 / 需购买 / 仅试听 / 无版权」，
  // 而不是把一切都压成 URL_RESOLVE_FAILED。
  let structuredCode: ErrorCode | null = null;
  let messageCode: ErrorCode | null = null;
  let lastMessage = "";
  const allowTrial = store.get("player.allowTrialPlay") === true;

  for (const plugin of candidates) {
    try {
      const resolved = await resolvePluginUrl({
        pluginId: plugin.manifest.id,
        source: pluginSource,
        quality,
        musicInfo,
      });
      if (!resolved.url) {
        if (resolved.reason) structuredCode = pluginUnavailableErrorCode(resolved.reason);
        continue;
      }
      // 插件声明为试听片段时，与官方音源一致地遵守「允许试听播放」设置。
      if (resolved.trial === true && !allowTrial) {
        structuredCode = ErrorCode.PROVIDER_TRIAL_DISABLED;
        continue;
      }
      return {
        source: resolved.url,
        provider: resolved.trial === true ? "trial" : "plugin",
        cacheAfterLoad:
          resolved.trial === true ? undefined : cacheAfterLoad(track, cacheKey, resolved.url),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message) lastMessage = message;
      const classified = classifyPluginFailureMessage(message);
      if (classified) messageCode = classified;
      // 兼容上游多插件兜底：单插件失败不阻止尝试下一候选。
      continue;
    }
  }
  const code = structuredCode ?? messageCode ?? ErrorCode.URL_RESOLVE_FAILED;
  throw sourceError(
    code,
    `Inherited plugin source failed for ${track.source} track: ${track.id} (${code})${
      lastMessage ? `: ${lastMessage}` : ""
    }`,
  );
};

/** Atom 音质档位 → QQ音乐 vkey 的 level 参数（模块内部即按这些 level 选模板） */
const QQMUSIC_LEVEL: Record<PluginQuality, string> = {
  lq: "lq",
  sq: "sq",
  hq: "hq",
  lossless: "lossless",
  "hi-res": "hi-res",
};

/**
 * Atom 音质档位 → 酷狗 /v5/url 的 quality 参数。
 *
 * 注意 hi-res **不能**映射到酷狗的 `high` 档：实测同一首歌
 * `quality=high` 返回的是 **mp3**，而 `quality=flac` 才返回 **flac**。
 * `high` 在酷狗是「最高可用」而非「无损」，对没有真 hi-res 的曲子会给出有损音源，
 * 在 Diretta strict Source Direct 这类只吃无损 PCM 的输出上会直接加载失败。
 * 因此这里把 hi-res 收敛到 flac，先保证无损；确实拿不到无损时由
 * 模块自身的降档链给 320/128，并由 OUTPUT_FORMAT_UNSUPPORTED 给出准确原因。
 */
const KUGOU_LEVEL: Record<PluginQuality, string> = {
  lq: "lq",
  sq: "sq",
  hq: "hq",
  lossless: "lossless",
  // 关键：不要用 "hi-res"，它会被模块映射到酷狗的 `high` 档，而 `high` 是
  // 「最高可用」不是「无损」——实测同一首歌 high→mp3、flac→flac。
  "hi-res": "lossless",
};

/** 比「解析失败」更有信息量的权益类错误；原生解析给出的这些原因要保留。 */
const INFORMATIVE_SOURCE_ERRORS: ReadonlySet<ErrorCode> = new Set([
  ErrorCode.PROVIDER_LOGIN_REQUIRED,
  ErrorCode.PROVIDER_VIP_REQUIRED,
  ErrorCode.PROVIDER_PURCHASE_REQUIRED,
  ErrorCode.PROVIDER_TRIAL_DISABLED,
  ErrorCode.PROVIDER_UNAVAILABLE,
]);

interface QQMusicSongUrlBody {
  code?: number;
  message?: string;
  data?: Array<{ url?: string; level?: string; format?: string }>;
}

interface KugouSongUrlBody {
  code?: number;
  message?: string;
  data?: { url?: string };
}

/**
 * 用 Core 自己的 QQ音乐 vkey 模块解析直链。
 *
 * 未登录时 QM 一律拿不到 purl（模块返回 403），这时给「需要登录」而不是
 * 「需要会员」——否则用户会去查会员，实际问题是没有登录。
 */
const resolveQQMusic = async (
  track: Track,
  quality: PluginQuality,
  cacheKey: string | null,
): Promise<ResolvedPlaybackSource> => {
  const body = (await callQQMusic("song_url", {
    mid: track.id,
    mediaMid: track.mediaId,
    level: QQMUSIC_LEVEL[quality],
  })) as QQMusicSongUrlBody;

  const item = body?.data?.[0];
  if (typeof item?.url === "string" && item.url) {
    return {
      source: item.url,
      provider: "official",
      format: item.format,
      cacheAfterLoad: cacheAfterLoad(track, cacheKey, item.url),
    };
  }

  if (!getProviderSessions().qqmusic.authenticated) {
    throw sourceError(ErrorCode.PROVIDER_LOGIN_REQUIRED, `QQ Music login required: ${track.id}`);
  }
  const code = classifyPluginFailureMessage(body?.message) ?? ErrorCode.PROVIDER_UNAVAILABLE;
  throw sourceError(code, `QQ Music track unavailable: ${track.id} (${body?.code ?? "?"})`);
};

/**
 * 用 Core 自己的酷狗 /v5/url 模块解析直链。
 *
 * 分两步：先按账号权益取整曲；取不到再退到「免费段」。
 * 注意免费段实测只有约 1MB（约 24 秒），是**试听片段**而不是整曲，
 * 因此必须按 trial 处理并遵守 `player.allowTrialPlay`，不能当整曲喂给播放器。
 */
const resolveKugou = async (
  track: Track,
  quality: PluginQuality,
  cacheKey: string | null,
): Promise<ResolvedPlaybackSource> => {
  const params = {
    hash: track.id,
    audioId: track.extId,
    albumId: track.album?.id,
    level: KUGOU_LEVEL[quality],
  };

  let body = (await callKugou("song_url", params)) as KugouSongUrlBody;
  let url = typeof body?.data?.url === "string" ? body.data.url : "";
  let trial = false;

  if (!url) {
    body = (await callKugou("song_url", { ...params, freePart: true })) as KugouSongUrlBody;
    url = typeof body?.data?.url === "string" ? body.data.url : "";
    trial = Boolean(url);
  }

  if (!url) {
    const code = classifyPluginFailureMessage(body?.message) ?? ErrorCode.PROVIDER_UNAVAILABLE;
    throw sourceError(code, `Kugou track unavailable: ${track.id} (${body?.code ?? "?"})`);
  }
  if (trial && store.get("player.allowTrialPlay") !== true) {
    throw sourceError(ErrorCode.PROVIDER_TRIAL_DISABLED, `Kugou trial disabled: ${track.id}`);
  }

  return {
    source: url,
    provider: trial ? "trial" : "official",
    cacheAfterLoad: trial ? undefined : cacheAfterLoad(track, cacheKey, url),
  };
};

/**
 * QM / KG 音源解析：**先用 Core 原生模块，失败再退到继承的 musicUrl 插件**。
 *
 * 为什么原生优先：这两个平台的 vkey / url 模块 Core 里本来就有，不需要用户装插件；
 * 之前只走插件路径，导致「一个插件都没装」的机器上点播放直接报
 * 「未找到支持该平台的插件」——而搜索是好的，看起来像播放坏了。
 *
 * 插件仍然保留为兜底（登录态更好或原生拿不到时它可能成功）。
 */
const resolveInheritedOnline = async (
  track: Track,
  quality: PluginQuality,
  cacheKey: string | null,
): Promise<ResolvedPlaybackSource> => {
  let nativeError: unknown = null;
  try {
    return track.source === "qqmusic"
      ? await resolveQQMusic(track, quality, cacheKey)
      : await resolveKugou(track, quality, cacheKey);
  } catch (error) {
    nativeError = error;
  }

  try {
    return await resolvePluginCompatibility(track, quality, cacheKey);
  } catch (pluginError) {
    // 原生给出了精确的权益原因就保留它；插件的「找不到插件」没有信息量。
    const nativeCode = nativeError instanceof PlaybackSourceError ? nativeError.code : null;
    if (nativeError && nativeCode && INFORMATIVE_SOURCE_ERRORS.has(nativeCode)) throw nativeError;
    throw pluginError;
  }
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
    const code = neteaseUnavailableErrorCode(item?.fee ?? track.fee);
    throw sourceError(code, `Netease track unavailable: ${track.id} (${code})`);
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
  })) as {
    streamUrl?: string;
    localPath?: string;
    codec?: string;
    size?: number;
  };
  if (resolved.localPath) {
    return { source: resolved.localPath, provider: "official", format: "m4a", size: resolved.size };
  }
  if (!resolved.streamUrl) {
    throw sourceError(ErrorCode.URL_RESOLVE_FAILED, `TIDAL track unavailable: ${track.id}`);
  }
  return {
    source: resolved.streamUrl,
    provider: "official",
    format: resolved.codec,
    size: resolved.size,
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
    const resolved = await resolveTidal(track, quality, null);
    return { source: resolved.source, format: resolved.format, size: resolved.size };
  }
  if (track.source === "qqmusic" || track.source === "kugou") {
    return { source: (await resolveInheritedOnline(track, quality, null)).source };
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
    return resolveInheritedOnline(track, quality, cacheKey);
  }

  throw sourceError(ErrorCode.NO_PLUGIN_AVAILABLE, `No Core source resolver for ${track.source}`);
};
