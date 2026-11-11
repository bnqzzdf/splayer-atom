import type { LyricsApi, LyricMatchResponse, LyricTTMLResponse } from "@shared/types/lyrics";
import { toServerTrack } from "./controlAssets";
import { request } from "./controlClient";

/** Web Control 的 Core Lyrics request client。 */
export const lyricsClient: LyricsApi = {
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
