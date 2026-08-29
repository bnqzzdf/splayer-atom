import type { Platform } from "../types/platform";
import type { MusicUrlReq } from "../types/plugin";
import type { Track, TrackSource } from "../types/player";

const PLATFORM_TO_PLUGIN_SOURCE: Partial<Record<Platform, string>> = {
  netease: "wy",
  qqmusic: "tx",
  kugou: "kg",
};

/** 上游插件协议沿用的在线平台 source key；Atom 不在这里扩展新 provider。 */
export const pluginPlaybackSource = (source: TrackSource): string | null =>
  PLATFORM_TO_PLUGIN_SOURCE[source as Platform] ?? null;

/**
 * 把 canonical Track 映射成现有 musicUrl 插件协议所需的兼容对象。
 * 字段保持与 upstream renderer resolver 一致，供下载兼容与 Core playback 共用。
 */
export const buildPluginPlaybackMusicInfo = (
  track: Track,
  pluginSource: string,
): MusicUrlReq["musicInfo"] => {
  const totalSec = track.duration > 0 ? Math.round(track.duration / 1000) : 0;
  const interval =
    totalSec > 0
      ? `${Math.floor(totalSec / 60)
          .toString()
          .padStart(2, "0")}:${(totalSec % 60).toString().padStart(2, "0")}`
      : null;
  const singer = track.artists.map((artist) => artist.name).join("/");
  const songId = track.id;
  const isHash = songId.length === 32 && /^[0-9a-fA-F]{32}$/.test(songId);
  const hash = isHash || track.source === "kugou" ? songId : "";
  const albumId = track.album?.id ?? "";
  const albumName = track.album?.name ?? "";
  const picUrl = track.cover ?? null;

  return {
    id: songId,
    songmid: songId,
    songId,
    name: track.title,
    singer,
    source: pluginSource,
    interval,
    img: picUrl,
    hash,
    albumId,
    albumName,
    meta: {
      songId,
      albumName,
      albumId,
      picUrl,
      hash,
    },
  };
};
