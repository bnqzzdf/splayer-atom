import type { IpcResponse, PlaybackSessionSnapshot, PlayerApi } from "@shared/types/player";
import { coreResult } from "./controlClient";

type SessionApi = Pick<
  PlayerApi,
  | "getSession"
  | "reloadSessionCurrent"
  | "migrateLegacySessionQueue"
  | "replaceSessionQueue"
  | "appendSessionQueue"
  | "insertSessionQueue"
  | "removeSessionQueueIndex"
  | "selectSessionIndex"
  | "nextSession"
  | "prevSession"
  | "updateSessionQueueItem"
  | "moveSessionQueue"
  | "removeSessionServerTracks"
  | "updateSessionQueueTracks"
  | "clearSessionQueue"
  | "setSessionRepeat"
  | "setSessionShuffle"
  | "startPersonalFm"
  | "dislikePersonalFm"
  | "setSessionAutoClose"
  | "cancelSessionAutoClose"
>;

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const patch = (body: unknown): RequestInit => ({ method: "PATCH", body: JSON.stringify(body) });

const mapReloadResult = async (
  result: Promise<IpcResponse<{ reloaded: boolean }>>,
): Promise<IpcResponse<boolean>> => {
  const resolved = await result;
  if (!resolved.success) return { success: false, error: resolved.error };
  if (!resolved.data) return { success: false, error: "CORE_RESPONSE_MISSING_DATA" };
  return { success: true, data: resolved.data.reloaded };
};

/**
 * renderer 对 authoritative playback session 的 Core Protocol 投影。
 * 这里只描述 path/payload，不持有 queue/player 状态，也不承载 Host Capability。
 */
export const sessionClient: SessionApi = {
  getSession: () => coreResult<PlaybackSessionSnapshot>("/session"),
  reloadSessionCurrent: (forcePlay) =>
    mapReloadResult(coreResult<{ reloaded: boolean }>("/session/reload", json({ forcePlay }))),
  migrateLegacySessionQueue: (items, originalItems, index, repeat, shuffle) =>
    coreResult<PlaybackSessionSnapshot>(
      "/session/migrate-legacy",
      json({ items, originalItems, index, repeat, shuffle }),
    ),
  replaceSessionQueue: (items, startIndex = 0, autoPlay = true, loadCurrent = true) =>
    coreResult<PlaybackSessionSnapshot>(
      "/session/queue",
      json({ items, startIndex, autoPlay, loadCurrent }),
    ),
  appendSessionQueue: (items) =>
    coreResult<PlaybackSessionSnapshot>("/session/queue/append", json({ items })),
  insertSessionQueue: (items, index) =>
    coreResult<PlaybackSessionSnapshot>("/session/queue/insert", json({ items, index })),
  removeSessionQueueIndex: (index, loadCurrent = true) =>
    coreResult<PlaybackSessionSnapshot>(
      `/session/queue/${index}?loadCurrent=${loadCurrent ? "1" : "0"}`,
      { method: "DELETE" },
    ),
  selectSessionIndex: (index, loadCurrent = true, autoPlay = true) =>
    coreResult<PlaybackSessionSnapshot>(
      "/session/queue/select",
      json({ index, loadCurrent, autoPlay }),
    ),
  nextSession: (loadCurrent = true) =>
    coreResult<PlaybackSessionSnapshot>("/session/next", json({ loadCurrent })),
  prevSession: (loadCurrent = true) =>
    coreResult<PlaybackSessionSnapshot>("/session/prev", json({ loadCurrent })),
  updateSessionQueueItem: (index, item) =>
    coreResult<PlaybackSessionSnapshot>(`/session/queue/${index}`, patch({ item })),
  moveSessionQueue: (fromIndex, toIndex) =>
    coreResult<PlaybackSessionSnapshot>("/session/queue/move", json({ fromIndex, toIndex })),
  removeSessionServerTracks: (serverId) =>
    coreResult<PlaybackSessionSnapshot>(`/session/server/${encodeURIComponent(serverId)}`, {
      method: "DELETE",
    }),
  updateSessionQueueTracks: (tracks) =>
    coreResult<PlaybackSessionSnapshot>("/session/queue/tracks", patch({ tracks })),
  clearSessionQueue: (stop = false) =>
    coreResult<PlaybackSessionSnapshot>("/session/queue/clear", json({ stop })),
  setSessionRepeat: (mode) =>
    coreResult<PlaybackSessionSnapshot>("/session/repeat", json({ mode })),
  setSessionShuffle: (mode) =>
    coreResult<PlaybackSessionSnapshot>("/session/shuffle", json({ mode })),
  startPersonalFm: (options, autoPlay = true) =>
    coreResult<PlaybackSessionSnapshot>("/session/personal-fm", json({ options, autoPlay })),
  dislikePersonalFm: (playedSec) =>
    coreResult<PlaybackSessionSnapshot>("/session/personal-fm/dislike", json({ playedSec })),
  setSessionAutoClose: (durationMin, waitSongEnd) =>
    coreResult<PlaybackSessionSnapshot>("/session/auto-close", json({ durationMin, waitSongEnd })),
  cancelSessionAutoClose: () =>
    coreResult<PlaybackSessionSnapshot>("/session/auto-close", { method: "DELETE" }),
};
