import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getLyricOffset = vi.hoisted(() => vi.fn().mockResolvedValue(0));

vi.mock("@/services/lyric/loader", () => ({ watchLyricPreference: vi.fn() }));
vi.mock("@/core/nowPlayingClient", () => ({
  nowPlayingClient: { getLyricOffset },
}));

import { useMediaStore } from "./media";

describe("media lyric commit", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getLyricOffset.mockClear();
  });

  it("无效候选不会清空已经解析成功的歌词", () => {
    const media = useMediaStore();
    const lrc = { source: "online" as const, format: "lrc" as const, platform: "netease" as const };

    expect(media.setLyric(lrc, { content: "[00:01.00]base" })).toBe(true);
    expect(
      media.setLyric(
        { source: "online", format: "ttml", platform: "netease" },
        { content: "<tt><broken></tt>" },
      ),
    ).toBe(false);

    expect(media.activeLyric).toEqual(lrc);
    expect(media.lyricContent?.content).toBe("[00:01.00]base");
    expect(media.parsedLyric).toHaveLength(1);
    expect(getLyricOffset).not.toHaveBeenCalled();
  });
});
