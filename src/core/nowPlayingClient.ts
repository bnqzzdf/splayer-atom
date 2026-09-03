import type { NowPlayingSnapshot } from "@shared/types/nowPlaying";
import type { Track } from "@shared/types/player";
import { controlAssetUrl } from "./controlAssets";
import { request } from "./controlClient";

type LightNowPlayingSnapshot = Omit<NowPlayingSnapshot, "lyric" | "source"> & {
  track: Track | null;
};

const mapTrack = (track: Track): Track => ({
  ...track,
  cover: controlAssetUrl(track.cover),
  coverOriginal: controlAssetUrl(track.coverOriginal),
});

/** Desktop 与 Web 共用的 Core NowPlaying query/command client。 */
export const nowPlayingClient = {
  getLyricOffset: async (): Promise<number> =>
    (await request<LightNowPlayingSnapshot>("/now-playing")).lyricOffsetMs,
  /** 读取 Core 已实际加载完成的当前 Track，用于 Control 投影一致性恢复。 */
  getCurrentTrack: async (): Promise<Track | null> => {
    const light = await request<LightNowPlayingSnapshot>("/now-playing");
    return light.track ? mapTrack(light.track) : null;
  },
  requestSnapshot: async (): Promise<NowPlayingSnapshot> => {
    const [light, lyric] = await Promise.all([
      request<LightNowPlayingSnapshot>("/now-playing"),
      request<{ lyric: NowPlayingSnapshot["lyric"]; source: NowPlayingSnapshot["source"] }>(
        "/lyrics",
      ),
    ]);
    return {
      ...light,
      track: light.track ? mapTrack(light.track) : null,
      lyric: lyric.lyric,
      source: lyric.source,
    };
  },
  setLyricOffset: (trackId: string, offsetMs: number): void => {
    void request("/now-playing/lyric-offset", {
      method: "POST",
      body: JSON.stringify({ trackId, offsetMs }),
    });
  },
};
