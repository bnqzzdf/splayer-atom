import type { PluginQuality } from "../../../shared/types/plugin";
import type { RepeatMode, ShuffleMode, Track } from "../../../shared/types/player";

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

/** 返回当前权威队列中可稳定预解析的下一项；shuffle 轮末需等 next() 完成重排。 */
export const nextPlaybackPreloadIndex = (
  index: number,
  queueLength: number,
  repeat: RepeatMode,
  shuffle: ShuffleMode,
): number | null => {
  if (index < 0 || queueLength <= 1 || repeat === "one") return null;
  if (shuffle === "on" && index >= queueLength - 1) return null;
  return index + 1 >= queueLength ? 0 : index + 1;
};
