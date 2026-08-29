import type {
  PlaybackContext,
  PlaybackQueueItem,
  PlaybackSessionSnapshot,
  Track,
} from "@shared/types/player";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  getItem: vi.fn(),
  removeItem: vi.fn(() => Promise.resolve()),
}));
const sessionApi = vi.hoisted(() => ({
  getSession: vi.fn(),
  migrateLegacySessionQueue: vi.fn(),
  clearSessionQueue: vi.fn(),
  removeSessionServerTracks: vi.fn(),
}));

vi.mock("localforage", () => ({
  default: {
    createInstance: () => storage,
  },
}));
vi.mock("@/core/sessionClient", () => ({ sessionClient: sessionApi }));

import {
  applySession,
  findTrackIndex,
  getQueueItem,
  getTrack,
  originalQueue,
  queue,
  queueEntries,
  restoreQueue,
} from "./queue";

const track = (id: string): Track => ({
  id,
  source: "local",
  title: id,
  artists: [],
  duration: 1_000,
});

const context: PlaybackContext = {
  provider: "netease",
  originId: "456",
  originType: "playlist",
  originName: "测试歌单",
};

const entry = (id: string, playbackContext?: PlaybackContext): PlaybackQueueItem => ({
  track: track(id),
  context: playbackContext,
});

const session = (
  items: PlaybackQueueItem[],
  options: Partial<PlaybackSessionSnapshot> = {},
): PlaybackSessionSnapshot => ({
  active: items.length > 0,
  queue: items,
  originalQueue: null,
  index: items.length > 0 ? 0 : -1,
  current: items[0]?.track ?? null,
  repeat: "list",
  shuffle: "off",
  ...options,
  mode: options.mode ?? "queue",
});

describe("queue projection", () => {
  beforeEach(() => {
    queueEntries.value = [];
    originalQueue.value = null;
    storage.getItem.mockReset();
    storage.removeItem.mockClear();
    sessionApi.getSession.mockReset();
    sessionApi.migrateLegacySessionQueue.mockReset();
    sessionApi.clearSessionQueue.mockReset();
    sessionApi.removeSessionServerTracks.mockReset();
  });

  it("只投影主进程会话并提供队列查询", () => {
    const data = session([entry("a", context), entry("b")], {
      originalQueue: [entry("b"), entry("a", context)],
      index: 1,
      current: track("b"),
      shuffle: "on",
    });

    applySession(data);
    data.queue[0].track.title = "mutated-outside";

    expect(queue.value.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(getTrack(0)?.title).toBe("a");
    expect(getTrack(99)).toBeNull();
    expect(getQueueItem(0)?.context).toEqual(context);
    expect(findTrackIndex("b")).toBe(1);
    expect(originalQueue.value?.map((item) => item.track.id)).toEqual(["b", "a"]);
  });

  it("main 已有权威队列时直接恢复并清理旧 IndexedDB", async () => {
    const data = session([entry("a"), entry("b")], { index: 1, current: track("b") });
    sessionApi.getSession.mockResolvedValue({ success: true, data });

    const restored = await restoreQueue({ index: 0, repeat: "one", shuffle: "on" });

    expect(restored).toEqual(data);
    expect(queue.value.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.removeItem).toHaveBeenCalledTimes(2);
    expect(sessionApi.migrateLegacySessionQueue).not.toHaveBeenCalled();
  });

  it("main 为空时一次性迁移旧 Track/QueueItem、原顺序和播放模式", async () => {
    const empty = session([]);
    const migrated = session([entry("b", context), entry("a")], {
      originalQueue: [entry("a"), entry("b", context)],
      index: 0,
      current: track("b"),
      repeat: "one",
      shuffle: "on",
    });
    sessionApi.getSession.mockResolvedValue({ success: true, data: empty });
    storage.getItem
      .mockResolvedValueOnce([{ ...track("b"), source: "netease" }, entry("a")])
      .mockResolvedValueOnce([entry("a"), entry("b", context)]);
    sessionApi.migrateLegacySessionQueue.mockResolvedValue({ success: true, data: migrated });

    const restored = await restoreQueue({ index: 0, repeat: "one", shuffle: "on" });

    expect(sessionApi.migrateLegacySessionQueue).toHaveBeenCalledWith(
      [{ track: { ...track("b"), source: "netease" } }, entry("a")],
      [entry("a"), entry("b", context)],
      0,
      "one",
      "on",
    );
    expect(restored).toEqual(migrated);
    expect(queueEntries.value[0].context).toEqual(context);
    expect(storage.removeItem).toHaveBeenCalledTimes(2);
  });

  it("迁移失败时保留旧 IndexedDB，避免不可恢复的数据丢失", async () => {
    sessionApi.getSession.mockResolvedValue({ success: true, data: session([]) });
    storage.getItem.mockResolvedValueOnce([track("a")]).mockResolvedValueOnce(null);
    sessionApi.migrateLegacySessionQueue.mockResolvedValue({ success: false, error: "UNKNOWN" });

    const restored = await restoreQueue({ index: 0, repeat: "list", shuffle: "off" });

    expect(restored).toBeNull();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(queueEntries.value).toEqual([]);
  });
});
