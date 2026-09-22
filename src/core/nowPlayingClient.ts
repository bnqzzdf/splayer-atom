import type { NowPlayingSnapshot } from "@shared/types/nowPlaying";
import type { LyricData } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import { controlAssetUrl } from "./controlAssets";
import { request } from "./controlClient";

const mapTrack = (track: Track): Track => ({
  ...track,
  cover: controlAssetUrl(track.cover),
  coverOriginal: controlAssetUrl(track.coverOriginal),
});

/** Web Control 的 Core NowPlaying query/command client。 */
export const nowPlayingClient = {
  getLyricOffset: async (trackId: string, source: LyricData): Promise<number> =>
    (
      await request<{ offsetMs: number }>("/now-playing/lyric-offset/query", {
        method: "POST",
        body: JSON.stringify({ trackId, source }),
      })
    ).offsetMs,
  /** 读取 Core 已实际加载完成的当前 Track/Detail，用于晚连接 Control 恢复。 */
  getCurrentPlayback: async (): Promise<NowPlayingSnapshot> => {
    const snapshot = await request<NowPlayingSnapshot>("/now-playing");
    return {
      ...snapshot,
      track: snapshot.track ? mapTrack(snapshot.track) : null,
    };
  },
  /** 只读当前已加载 Track 的轻量兼容入口。 */
  getCurrentTrack: async (): Promise<Track | null> =>
    (await nowPlayingClient.getCurrentPlayback()).track,
  setLyricOffset: (trackId: string, source: LyricData, offsetMs: number): void => {
    void request("/now-playing/lyric-offset", {
      method: "POST",
      body: JSON.stringify({ trackId, source, offsetMs }),
    });
  },
};
