import type { Track } from "@shared/types/player";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveLocalRepoLyric: vi.fn(),
  resolveOnlineByPreference: vi.fn(),
  resolvePluginLyric: vi.fn(),
  resolveStreamingByPreference: vi.fn(),
  resolveTTMLOverlay: vi.fn(),
}));

vi.mock("@/services/lyric/resolve", () => ({
  isBetterFormat: () => false,
  isPluginLyricPreferred: () => false,
  resolveLocalRepoLyric: mocks.resolveLocalRepoLyric,
  resolveOnlineByPreference: mocks.resolveOnlineByPreference,
  resolvePluginLyric: mocks.resolvePluginLyric,
  resolveStreamingByPreference: mocks.resolveStreamingByPreference,
  resolveTTMLOverlay: mocks.resolveTTMLOverlay,
}));

import { resolveDownloadLyric } from "./lyric";

const track: Track = {
  id: "song-1",
  source: "streaming",
  serverId: "server-1",
  originalId: "original-1",
  title: "Song",
  artists: [{ name: "Artist" }],
  duration: 180_000,
};

const base = {
  source: { source: "online" as const, format: "lrc" as const, platform: "netease" as const },
  input: { content: "[00:01.00]base" },
};

describe("download lyric", () => {
  beforeEach(() => {
    mocks.resolveLocalRepoLyric.mockReset().mockResolvedValue(null);
    mocks.resolveOnlineByPreference.mockReset().mockResolvedValue(null);
    mocks.resolvePluginLyric.mockReset().mockResolvedValue(null);
    mocks.resolveStreamingByPreference.mockReset().mockResolvedValue(base);
    mocks.resolveTTMLOverlay.mockReset();
  });

  it("流媒体下载同步等待 TTML 最终结果", async () => {
    mocks.resolveTTMLOverlay.mockResolvedValue({
      source: { source: "online", format: "ttml", platform: "netease" },
      input: {
        content:
          '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="0s" end="1s">final</p></div></body></tt>',
      },
    });

    const resolved = await resolveDownloadLyric(track);

    expect(mocks.resolveTTMLOverlay).toHaveBeenCalledOnce();
    expect(resolved?.format).toBe("ttml");
  });

  it("下载遇到畸形 TTML 时回退基础歌词", async () => {
    mocks.resolveTTMLOverlay.mockResolvedValue({
      source: { source: "online", format: "ttml", platform: "netease" },
      input: { content: "<tt><broken></tt>" },
    });

    const resolved = await resolveDownloadLyric(track);

    expect(resolved?.format).toBe("lrc");
    expect(resolved?.content).toBe("[00:01.00]base");
  });

  it("下载遇到 TTML 请求失败时回退基础歌词", async () => {
    mocks.resolveTTMLOverlay.mockRejectedValue(new Error("network"));

    const resolved = await resolveDownloadLyric(track);

    expect(resolved?.format).toBe("lrc");
  });

  it("平台歌曲下载也同步使用最终 TTML", async () => {
    mocks.resolveOnlineByPreference.mockResolvedValue(base);
    mocks.resolveTTMLOverlay.mockResolvedValue({
      source: { source: "online", format: "ttml", platform: "netease" },
      input: {
        content:
          '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="0s" end="1s">final</p></div></body></tt>',
      },
    });

    const resolved = await resolveDownloadLyric({ ...track, source: "netease" });

    expect(resolved?.format).toBe("ttml");
    expect(mocks.resolveTTMLOverlay).toHaveBeenCalledOnce();
  });
});
