import {
  coreApiOrigin,
  ensureCoreProtocolCompatible,
  getCoreInfo,
  request,
} from "@/core/controlClient";
import { serverAssetUrl, webAssetUrl } from "@/core/controlAssets";
import { subscribeControlEvent } from "@/core/controlEventClient";
import type {
  AudioDevice,
  PlaybackQueueItem,
  PlaybackSessionSnapshot,
  PlayerStatus,
  RepeatMode,
  ShuffleMode,
  Track,
} from "@shared/types/player";

export type HeadlessSession = PlaybackSessionSnapshot;

export interface OutputSnapshot {
  selected: string | null;
  data: AudioDevice[];
}

export const apiOrigin = coreApiOrigin;

export { ensureCoreProtocolCompatible, getCoreInfo, request, serverAssetUrl, webAssetUrl };

export const headlessClient = {
  tracks: (): Promise<{ data: Track[]; total: number }> => request("/library/tracks"),
  scanDirs: (): Promise<{ data: string[] }> => request("/library/scan-dirs"),
  setScanDirs: (dirs: string[]): Promise<{ success: boolean; data: string[] }> =>
    request("/library/scan-dirs", { method: "POST", body: JSON.stringify({ dirs }) }),
  scanLibrary: (incremental = true): Promise<{ success: boolean; error?: string }> =>
    request("/library/scan", { method: "POST", body: JSON.stringify({ incremental }) }),
  isScanning: (): Promise<{ data: boolean }> => request("/library/is-scanning"),
  session: (): Promise<HeadlessSession> => request("/session"),
  status: (): Promise<PlayerStatus> => request("/status"),
  nowPlaying: (): Promise<{ track: Track | null }> => request("/now-playing"),
  playTrack: (track: Track): Promise<HeadlessSession> =>
    request("/session/play-track", { method: "POST", body: JSON.stringify({ track }) }),
  replaceQueue: (items: PlaybackQueueItem[], startIndex = 0): Promise<HeadlessSession> =>
    request("/session/queue", {
      method: "POST",
      body: JSON.stringify({ items, startIndex, autoPlay: true }),
    }),
  appendQueue: (items: PlaybackQueueItem[]): Promise<HeadlessSession> =>
    request("/session/queue/append", { method: "POST", body: JSON.stringify({ items }) }),
  insertQueue: (items: PlaybackQueueItem[], index: number): Promise<HeadlessSession> =>
    request("/session/queue/insert", {
      method: "POST",
      body: JSON.stringify({ items, index }),
    }),
  moveQueue: (fromIndex: number, toIndex: number): Promise<HeadlessSession> =>
    request("/session/queue/move", {
      method: "POST",
      body: JSON.stringify({ fromIndex, toIndex }),
    }),
  selectQueueIndex: (index: number, autoPlay = true): Promise<HeadlessSession> =>
    request("/session/queue/select", {
      method: "POST",
      body: JSON.stringify({ index, autoPlay }),
    }),
  removeQueueIndex: (index: number): Promise<HeadlessSession> =>
    request(`/session/queue/${index}`, { method: "DELETE" }),
  clearQueue: (): Promise<HeadlessSession> => request("/session/queue", { method: "DELETE" }),
  setRepeat: (mode: RepeatMode): Promise<HeadlessSession> =>
    request("/session/repeat", { method: "POST", body: JSON.stringify({ mode }) }),
  setShuffle: (mode: ShuffleMode): Promise<HeadlessSession> =>
    request("/session/shuffle", { method: "POST", body: JSON.stringify({ mode }) }),
  play: (): Promise<{ ok: boolean }> => request("/play", { method: "POST" }),
  pause: (): Promise<{ ok: boolean }> => request("/pause", { method: "POST" }),
  stop: (): Promise<{ ok: boolean }> => request("/stop", { method: "POST" }),
  next: (): Promise<{ ok: boolean }> => request("/next", { method: "POST" }),
  prev: (): Promise<{ ok: boolean }> => request("/prev", { method: "POST" }),
  seek: (positionMs: number): Promise<{ ok: boolean }> =>
    request("/seek", { method: "POST", body: JSON.stringify({ positionMs }) }),
  outputs: (): Promise<OutputSnapshot> => request("/output/devices"),
  selectOutput: (deviceId: string | null): Promise<{ ok: boolean; selected: string | null }> =>
    request("/output/select", { method: "POST", body: JSON.stringify({ deviceId }) }),
  connectEvents: subscribeControlEvent,
};
