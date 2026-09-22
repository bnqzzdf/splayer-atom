import type { LyricLine } from "@shared/types/lyrics";
import { describe, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => ({
  settings: { player: { showProgressLyric: true, snapToLyric: false } },
  media: { parsedLyric: [] as LyricLine[] },
}));

vi.mock("@/stores/settings", () => ({ useSettingsStore: () => stores.settings }));
vi.mock("@/stores/media", () => ({ useMediaStore: () => stores.media }));

import { useProgressLyric } from "./useProgressLyric";

describe("useProgressLyric", () => {
  it("进度条提示保留英文逐词歌词空格", () => {
    stores.media.parsedLyric = [
      {
        words: [
          { word: "Hello", startTime: 0, endTime: 400 },
          { word: " ", startTime: 400, endTime: 500 },
          { word: "world", startTime: 500, endTime: 1_000 },
        ],
        translatedLyric: "",
        romanLyric: "",
        startTime: 0,
        endTime: 1_000,
        isBG: false,
        isDuet: false,
      },
    ];

    expect(useProgressLyric().formatTooltip(500)).toContain("Hello world");
  });
});
