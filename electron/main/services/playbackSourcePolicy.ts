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
