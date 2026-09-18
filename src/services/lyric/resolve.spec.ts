import type { Track } from "@shared/types/player";
import type { LyricMatchResult } from "@shared/types/lyrics";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: {
    lyric: {
      lyricSourcePreference: "auto" as string,
      lyricSourceOrder: ["netease", "qqmusic", "kugou"],
      lyricFormatOrder: ["ttml", "qrc", "krc", "yrc", "lrc", "ass", "srt"],
      smartPreferOnline: false,
      preferPluginLyric: false,
    },
    system: {
      lyric: { enableOnlineTTMLLyric: true },
      localLyric: { enableLocalTTMLOverride: false, repoDir: "" },
    },
  },
  requestPlatformLyric: vi.fn(),
  requestStreamingLyric: vi.fn(),
  requestTTMLOverlay: vi.fn(),
}));

vi.mock("@/stores/settings", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("@/stores/plugins", () => ({ usePluginsStore: () => ({ list: [] }) }));
vi.mock("./request", () => ({
  requestPlatformLyric: mocks.requestPlatformLyric,
  requestStreamingLyric: mocks.requestStreamingLyric,
  requestTTMLOverlay: mocks.requestTTMLOverlay,
}));
vi.mock("@/core/lyricsClient", () => ({
  lyricsClient: { matchLocalTTML: vi.fn(async () => ({ ok: true, data: null })) },
}));
vi.mock("@/core/pluginClient", () => ({ pluginClient: { matchLyric: vi.fn() } }));

import {
  resolveLyricForPreload,
  resolveOnlineByPreference,
  resolveStreamingByPreference,
} from "./resolve";

const track: Track = {
  id: "song-1",
  source: "netease",
  title: "Song",
  artists: [{ name: "Artist" }],
  duration: 180_000,
};

const result = (platform: LyricMatchResult["platform"], format = "lrc"): LyricMatchResult => ({
  platform,
  format: format as LyricMatchResult["format"],
  content: `[00:01.00]${platform}`,
});

describe("lyric resolve", () => {
  beforeEach(() => {
    mocks.settings.lyric.lyricSourcePreference = "auto";
    mocks.settings.lyric.lyricSourceOrder = ["netease", "qqmusic", "kugou"];
    mocks.settings.lyric.smartPreferOnline = false;
    mocks.settings.lyric.preferPluginLyric = false;
    mocks.requestPlatformLyric.mockReset();
    mocks.requestStreamingLyric.mockReset();
    mocks.requestTTMLOverlay.mockReset();
  });

  it("显式平台未命中时按来源顺序回退并跳过已尝试平台", async () => {
    mocks.settings.lyric.lyricSourcePreference = "netease";
    mocks.requestPlatformLyric.mockImplementation(async (platform: string) =>
      platform === "qqmusic" ? result("qqmusic") : null,
    );

    const resolved = await resolveOnlineByPreference(track, {
      hasLocal: false,
      localFormat: null,
    });

    expect(resolved?.source.platform).toBe("qqmusic");
    expect(mocks.requestPlatformLyric.mock.calls.map(([platform]) => platform)).toEqual([
      "netease",
      "qqmusic",
    ]);
  });

  it("显式平台命中时不继续查询回退来源", async () => {
    mocks.settings.lyric.lyricSourcePreference = "qqmusic";
    mocks.requestPlatformLyric.mockResolvedValue(result("qqmusic", "qrc"));

    const resolved = await resolveOnlineByPreference(track, {
      hasLocal: false,
      localFormat: null,
    });

    expect(resolved?.source).toMatchObject({ platform: "qqmusic", format: "qrc" });
    expect(mocks.requestPlatformLyric).toHaveBeenCalledTimes(1);
    expect(mocks.requestPlatformLyric).toHaveBeenCalledWith("qqmusic", track);
  });

  it("智能在线模式下显式平台未命中仍并发选择最佳回退格式", async () => {
    mocks.settings.lyric.lyricSourcePreference = "netease";
    mocks.settings.lyric.smartPreferOnline = true;
    mocks.requestPlatformLyric.mockImplementation(async (platform: string) => {
      if (platform === "qqmusic") return result("qqmusic", "qrc");
      if (platform === "kugou") return result("kugou", "lrc");
      return null;
    });

    const resolved = await resolveOnlineByPreference(track, {
      hasLocal: false,
      localFormat: null,
    });

    expect(resolved?.source).toMatchObject({ platform: "qqmusic", format: "qrc" });
    expect(mocks.requestPlatformLyric.mock.calls.map(([platform]) => platform)).toEqual([
      "netease",
      "qqmusic",
      "kugou",
    ]);
  });

  it("self 只查询歌曲自身平台", async () => {
    mocks.settings.lyric.lyricSourcePreference = "self";
    mocks.requestPlatformLyric.mockResolvedValue(result("netease"));

    await resolveOnlineByPreference(track, { hasLocal: false, localFormat: null });

    expect(mocks.requestPlatformLyric).toHaveBeenCalledTimes(1);
    expect(mocks.requestPlatformLyric).toHaveBeenCalledWith("netease", track);
  });

  it("流媒体显示解析不等待 TTML", async () => {
    mocks.settings.lyric.lyricSourcePreference = "netease";
    mocks.requestPlatformLyric.mockResolvedValue(result("netease"));

    const resolved = await resolveStreamingByPreference({
      ...track,
      source: "streaming",
      serverId: "server-1",
      originalId: "original-1",
    });

    expect(resolved?.source.format).toBe("lrc");
    expect(mocks.requestTTMLOverlay).not.toHaveBeenCalled();
  });

  it("预载返回基础歌词而不等待 TTML", async () => {
    mocks.settings.lyric.lyricSourcePreference = "netease";
    mocks.requestPlatformLyric.mockResolvedValue(result("netease"));

    const resolved = await resolveLyricForPreload(track, () => true);

    expect(resolved?.source.format).toBe("lrc");
    expect(mocks.requestTTMLOverlay).not.toHaveBeenCalled();
  });
});
