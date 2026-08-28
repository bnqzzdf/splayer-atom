import crypto from "node:crypto";
import type { PluginQuality } from "@shared/types/plugin";
import type { Track } from "@shared/types/player";
import { playbackSourceCacheKey } from "@main/services/playbackSourcePolicy";
import { callNetease } from "@main/apis/netease";
import { callQobuz } from "@main/apis/qobuz";
import { callTidal } from "@main/apis/tidal";
import { store } from "@main/store";
import * as songCache from "@main/services/songCache";
import { withStreamingAdapter } from "@main/services/streaming/connection";

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
  provider: "local" | "cache" | "streaming" | "official" | "trial";
  cacheAfterLoad?: () => Promise<void>;
}

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
): (() => Promise<void>) | undefined => {
  if (!cacheEnabled(track, cacheKey) || !cacheKey || !/^https?:\/\//i.test(source))
    return undefined;
  return async () => {
    await songCache.fetchAsync(cacheKey, track.source, source);
  };
};

const resolveStreaming = async (
  track: Track,
  cacheKey: string | null,
): Promise<ResolvedPlaybackSource> => {
  if (!track.serverId) throw new Error(`Streaming track missing serverId: ${track.id}`);
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
            await songCache.fetchAsync(cacheKey, "streaming", cacheSource);
          }
        : undefined,
  };
};

const resolveNetease = async (
  track: Track,
  quality: PluginQuality,
  cacheKey: string | null,
): Promise<ResolvedPlaybackSource> => {
  const response = await callNetease("song_url", {
    id: track.id,
    level: NETEASE_LEVEL[quality],
  });
  const item = (response.body as { data?: unknown[] } | undefined)?.data?.[0] as
    { url?: unknown; freeTrialInfo?: unknown; fee?: unknown } | undefined;
  const source = typeof item?.url === "string" ? item.url : "";
  if (!source) {
    const fee = Number(item?.fee ?? track.fee);
    if (fee === 1 || fee === 4) throw new Error(`NETEASE_VIP_REQUIRED:${track.id}`);
    throw new Error(`NETEASE_UNAVAILABLE:${track.id}`);
  }
  const isTrial = item?.freeTrialInfo != null;
  if (isTrial && store.get("player.allowTrialPlay") !== true) {
    throw new Error(`NETEASE_TRIAL_DISABLED:${track.id}`);
  }
  return {
    source,
    provider: isTrial ? "trial" : "official",
    cacheAfterLoad: isTrial ? undefined : cacheAfterLoad(track, cacheKey, source),
  };
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
  if (!resolved.url || resolved.sample) throw new Error(`QOBUZ_UNAVAILABLE:${track.id}`);
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
  if (!resolved.streamUrl) throw new Error(`TIDAL_UNAVAILABLE:${track.id}`);
  return {
    source: resolved.streamUrl,
    provider: "official",
    cacheAfterLoad: cacheAfterLoad(track, cacheKey, resolved.streamUrl),
  };
};

/**
 * 从 canonical Track 解析当前时刻可播放输入。
 * Core 持有音质、试听、缓存与 provider session 权威；Control 不下发最终 URL。
 */
export const resolvePlaybackSource = async (track: Track): Promise<ResolvedPlaybackSource> => {
  if (track.source === "local") {
    const source = track.cueAudioPath ?? track.path;
    if (!source) throw new Error(`Local track has no playable path: ${track.id}`);
    return { source, provider: "local" };
  }

  const quality = store.get("player.songLevel");
  const cacheKey = playbackSourceCacheKey(track, quality);
  const cached = await cacheResult(track, cacheKey);
  if (cached) return cached;

  if (track.source === "streaming") return resolveStreaming(track, cacheKey);
  if (track.source === "netease") return resolveNetease(track, quality, cacheKey);
  if (track.source === "qobuz") return resolveQobuz(track, quality, cacheKey);
  if (track.source === "tidal") return resolveTidal(track, quality, cacheKey);

  throw new Error(
    `Core playback source is not available for inherited ${track.source} track: ${track.id}`,
  );
};
