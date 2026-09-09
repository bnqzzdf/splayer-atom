import type {
  PlaybackContext,
  PlaybackQueueItem,
  PlaybackSessionSnapshot,
  Track,
} from "@shared/types/player";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionApi = vi.hoisted(() => ({
  getSession: vi.fn(),
  clearSessionQueue: vi.fn(),
  removeSessionServerTracks: vi.fn(),
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
    sessionApi.getSession.mockReset();
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

  it("直接恢复 Core 权威队列，不读取 renderer 持久化", async () => {
    const data = session([entry("a"), entry("b")], { index: 1, current: track("b") });
    sessionApi.getSession.mockResolvedValue({ success: true, data });

    const restored = await restoreQueue();

    expect(restored).toEqual(data);
    expect(queue.value.map(({ id }) => id)).toEqual(["a", "b"]);
  });

  it("Core 会话读取失败时不制造第二份本地队列", async () => {
    sessionApi.getSession.mockResolvedValue({ success: false, error: "NETWORK_ERROR" });

    const restored = await restoreQueue();

    expect(restored).toBeNull();
    expect(queueEntries.value).toEqual([]);
  });
});
