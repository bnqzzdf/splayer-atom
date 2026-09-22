import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { ErrorCode } from "@shared/types/errors";
import type { PlaybackQueueItem, Track } from "@shared/types/player";

const resolvedTrackIds: string[] = [];
const loadedTrackIds: string[] = [];
const loadedSources: string[] = [];
const preloadIndexes: number[] = [];
const materializedSources: string[] = [];
let resolverBehavior: (track: Track, callCount: number) => string = (track) =>
  `https://media.invalid/${track.id}`;
const resolveCountByTrack = new Map<string, number>();
const storeValues = new Map<string, unknown>();
let playerState: "playing" | "paused" | "stopped" = "playing";
let selectedOutput: string | null = null;

const noop = (): void => {};
const asyncNoop = async (): Promise<void> => {};
const fakePlayer = {
  pause: () => {
    playerState = "paused";
  },
  play: async () => {
    playerState = "playing";
  },
  stop: () => {
    playerState = "stopped";
  },
  seek: asyncNoop,
  getStatus: () => ({ state: playerState }),
  getPosition: () => 0,
  getOutputDevices: () => [],
  scanDirettaDevices: async () => [],
  setOutputDevice: async (deviceId?: string) => {
    selectedOutput = deviceId ?? null;
  },
  getDefaultDeviceName: () => null,
  getSelectedDeviceName: () => selectedOutput,
};

mock.module("@main/services/engine", {
  namedExports: {
    getPlayer: () => fakePlayer,
  },
});
mock.module("@main/database/playbackSession", {
  namedExports: {
    loadPlaybackSession: () => null,
    savePlaybackSession: noop,
  },
});
mock.module("@main/services/nowPlaying", {
  namedExports: {
    update: noop,
    onPosition: noop,
    onPlayStateChange: noop,
  },
});
mock.module("@main/services/playerLoad", {
  namedExports: {
    loadPlayerSource: async (source: string, options: { autoPlay?: boolean; meta?: Track }) => {
      loadedSources.push(source);
      playerState = options.autoPlay === false ? "paused" : "playing";
      if (options.meta) loadedTrackIds.push(options.meta.id);
      return {
        success: true,
        data: {
          detail: undefined,
          mediaInfo: { duration: options.meta?.duration ?? 180_000 },
        },
      };
    },
  },
});
mock.module("@main/services/playbackSourceResolver", {
  namedExports: {
    resolvePlaybackSource: async (track: Track) => {
      const count = (resolveCountByTrack.get(track.id) ?? 0) + 1;
      resolveCountByTrack.set(track.id, count);
      resolvedTrackIds.push(track.id);
      return { source: resolverBehavior(track, count), provider: "netease" };
    },
    playbackSourceErrorCode: () => ErrorCode.URL_RESOLVE_FAILED,
  },
});
mock.module("@main/services/playbackPreloader", {
  namedExports: {
    consumeDirectPlaybackBoundary: () => null,
    consumePlaybackPreload: () => null,
    invalidatePlaybackPreload: noop,
    schedulePlaybackPreload: (index: number) => preloadIndexes.push(index),
  },
});
mock.module("@main/services/directGapless", {
  namedExports: { commitDirectPlaybackBoundary: async () => false },
});
mock.module("@main/atom/directInput", {
  namedExports: {
    discardDirectInput: asyncNoop,
    materializeDirectInput: async (source: string) => {
      materializedSources.push(source);
      return `/tmp/direct-${materializedSources.length}`;
    },
  },
});
mock.module("@main/services/playerTimeline", {
  namedExports: {
    clearActiveCueRange: noop,
    toDisplayPositionMs: (value: number) => value,
    toEnginePositionMs: (value: number) => value,
  },
});
mock.module("@main/runtime", { namedExports: { isHeadlessMode: () => false } });
mock.module("@main/store", {
  namedExports: {
    store: {
      get: (key: string) => storeValues.get(key) ?? false,
      set: (key: string, value: unknown) => storeValues.set(key, value),
    },
  },
});
mock.module("@main/services/coreControlEvents", {
  namedExports: { publishCoreControlEvent: noop },
});
mock.module("@main/utils/logger", {
  namedExports: {
    playerLog: { info: noop, warn: noop, error: noop },
  },
});
mock.module("@main/utils/time", { namedExports: { toMs: (value: number) => value } });
mock.module("@main/services/personalFm", {
  namedExports: {
    advancePersonalFmPool: async () => [],
    alignPersonalFmPool: () => [],
    dislikePersonalFmCurrent: async () => [],
    getPersonalFmOptions: () => undefined,
    resetPersonalFmPool: noop,
    startPersonalFmPool: async () => [],
  },
});

const session = await import("../playbackSession");

const track = (id: string): Track => ({
  id,
  source: "netease",
  title: `Track ${id}`,
  artists: [{ id: `artist-${id}`, name: `Artist ${id}` }],
  album: { id: `album-${id}`, name: `Album ${id}` },
  duration: 180_000,
});
const queue = (...ids: string[]): PlaybackQueueItem[] =>
  ids.map((id) => ({
    track: track(id),
    context: {
      provider: "netease",
      originId: "acceptance-playlist",
      originType: "playlist",
      originName: "Core Acceptance Playlist",
    },
  }));

const resetObservations = (): void => {
  resolvedTrackIds.length = 0;
  loadedTrackIds.length = 0;
  loadedSources.length = 0;
  preloadIndexes.length = 0;
  materializedSources.length = 0;
  resolveCountByTrack.clear();
  resolverBehavior = (item) => `https://media.invalid/${item.id}`;
  storeValues.clear();
  storeValues.set("player.outputDevice", null);
  storeValues.set("player.pauseOnDeviceSwitch", false);
  storeValues.set("player.fuckDjMode", false);
  playerState = "playing";
  selectedOutput = null;
};

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail("timed out waiting for playback session transition");
};

test("Core advances a three-track online queue without any Control callback", async () => {
  resetObservations();
  await session.replaceQueue(queue("one", "two", "three"), 0, true, true);
  assert.equal(session.getPlaybackSession().index, 0);
  assert.deepEqual(loadedTrackIds, ["one"]);

  assert.equal(session.onNativeEnded(), true);
  await waitFor(() => loadedTrackIds.length === 2 && session.getPlaybackSession().index === 1);
  assert.equal(session.onNativeEnded(), true);
  await waitFor(() => loadedTrackIds.length === 3 && session.getPlaybackSession().index === 2);

  assert.deepEqual(loadedTrackIds, ["one", "two", "three"]);
  assert.deepEqual(resolvedTrackIds, ["one", "two", "three"]);
  assert.ok(preloadIndexes.includes(1));
  assert.ok(preloadIndexes.includes(2));
});

test("online queue survives ALSA then Diretta output switching before Core auto-next", async () => {
  resetObservations();
  await session.replaceQueue(queue("switch-one", "switch-two"), 0, true, true);

  await session.setOutputDevice("hw:0,0");
  assert.equal(session.getSelectedOutputDevice(), "hw:0,0");
  assert.deepEqual(materializedSources, []);

  await session.setOutputDevice("diretta:living-room");
  assert.equal(session.getSelectedOutputDevice(), "diretta:living-room");
  assert.deepEqual(materializedSources, ["https://media.invalid/switch-one"]);
  assert.ok(loadedSources.includes("/tmp/direct-1"));

  assert.equal(session.onNativeEnded(), true);
  await waitFor(
    () => loadedTrackIds.at(-1) === "switch-two" && session.getPlaybackSession().index === 1,
  );

  assert.equal(session.getSelectedOutputDevice(), "diretta:living-room");
  assert.deepEqual(resolvedTrackIds, ["switch-one", "switch-one", "switch-one", "switch-two"]);
  assert.deepEqual(loadedTrackIds, ["switch-one", "switch-one", "switch-one", "switch-two"]);
});

test("Core fresh-resolves one online track only once before advancing", async () => {
  resetObservations();
  await session.replaceQueue(queue("expired", "next"), 0, true, true);

  assert.equal(session.onNativeSourceError(), true);
  await waitFor(() => loadedTrackIds.length === 2);
  assert.equal(session.getPlaybackSession().index, 0);

  assert.equal(session.onNativeSourceError(), true);
  await waitFor(() => session.getPlaybackSession().index === 1);

  assert.deepEqual(resolvedTrackIds, ["expired", "expired", "next"]);
  assert.deepEqual(loadedTrackIds, ["expired", "expired", "next"]);
});

test("Core advances when the one allowed fresh resolve itself fails", async () => {
  resetObservations();
  resolverBehavior = (item, callCount) => {
    if (item.id === "broken" && callCount === 2) throw new Error("expired url");
    return `https://media.invalid/${item.id}/${callCount}`;
  };
  await session.replaceQueue(queue("broken", "fallback"), 0, true, true);

  assert.equal(session.onNativeSourceError(), true);
  await waitFor(() => session.getPlaybackSession().index === 1);

  assert.deepEqual(resolvedTrackIds, ["broken", "broken", "fallback"]);
  assert.deepEqual(loadedTrackIds, ["broken", "fallback"]);
});
