import type { LyricsApi, LyricMatchResponse, LyricTTMLResponse } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import { serverAssetUrl } from "./controlAssets";
import { request } from "./controlClient";

type CoreLyricsClient = Omit<LyricsApi, "pickLyricRepoDir">;

const toServerTrack = (track: Track): Track => ({
  ...track,
  cover: serverAssetUrl(track.cover),
  coverOriginal: serverAssetUrl(track.coverOriginal),
});

/** Web Control 的 Core Lyrics request client。 */
export const lyricsClient: CoreLyricsClient = {
  matchById: (platform, id) =>
    request<LyricMatchResponse>("/lyrics/match-by-id", {
      method: "POST",
      body: JSON.stringify({ platform, id }),
    }),
  matchByQuery: (platform, track) =>
    request<LyricMatchResponse>("/lyrics/match-by-query", {
      method: "POST",
      body: JSON.stringify({ platform, track: toServerTrack(track) }),
    }),
  fetchTTMLOverlay: (track, platform) =>
    request<LyricTTMLResponse>("/lyrics/ttml-overlay", {
      method: "POST",
      body: JSON.stringify({ track: toServerTrack(track), platform }),
    }),
  matchLocalTTML: (track) =>
    request<LyricTTMLResponse>("/lyrics/local", {
      method: "POST",
      body: JSON.stringify({ track: toServerTrack(track) }),
    }),
};
