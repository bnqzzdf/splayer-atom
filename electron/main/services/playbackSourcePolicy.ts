import type { PluginQuality } from "../../../shared/types/plugin";
import type { Track } from "../../../shared/types/player";

export type PlaybackCacheKeyTrack = Pick<Track, "id" | "source" | "serverId" | "originalId">;

/** Core 播放缓存键策略；仅表达 canonical Track + Core policy，不执行 I/O。 */
export const playbackSourceCacheKey = (
  track: PlaybackCacheKeyTrack,
  quality: PluginQuality,
): string | null => {
  if (track.source === "streaming" && track.serverId && track.originalId) {
    return `s:${track.serverId}:${track.originalId}:`;
  }
  if (
    (track.source === "netease" || track.source === "qobuz" || track.source === "tidal") &&
    track.id
  ) {
    return `o:${track.source}:${track.id}:${quality}`;
  }
  if ((track.source === "qqmusic" || track.source === "kugou") && track.id) {
    return `o:${track.source}:${track.id}:`;
  }
  return null;
};

/** Native sourceError 只允许在线/流媒体输入对同一 canonical Track fresh resolve 一次。 */
export const shouldRetryPlaybackSource = (
  track: Pick<Track, "source">,
  attempts: number,
): boolean => track.source !== "local" && attempts < 1;
