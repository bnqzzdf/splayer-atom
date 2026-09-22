import type { Track } from "@shared/types/player";
import type { LyricData, LyricFormat, LyricInput } from "@shared/types/lyrics";
import type { Platform } from "@shared/types/platform";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const media = {
    track: null as Track | null,
    detail: null,
    activeLyric: null as LyricData,
    lyricContent: null as LyricInput | null,
    parsedLyric: [] as Array<{ words: Array<{ word: string }> }>,
    resetLyricState: vi.fn(),
    setLyric: vi.fn(),
  };
  return {
    media,
    settings: {
      lyric: {
        lyricSourcePreference: "auto",
        lyricFormatOrder: ["ttml", "qrc", "krc", "yrc", "lrc", "ass", "srt"],
        preferPluginLyric: false,
      },
      system: {
        lyric: { enableOnlineTTMLLyric: true },
        localLyric: { enableLocalTTMLOverride: false, repoDir: "" },
      },
    },
    consumePreloadedLyric: vi.fn(),
    resolveLocalRepoLyric: vi.fn(),
    resolveOnlineByPreference: vi.fn(),
    resolvePluginLyric: vi.fn(),
    resolveStreamingByPreference: vi.fn(),
    resolveTTMLOverlay: vi.fn(),
    watch: vi.fn(),
  };
});

vi.mock("vue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue")>()),
  watch: mocks.watch,
}));
vi.mock("@/stores/media", () => ({ useMediaStore: () => mocks.media }));
vi.mock("@/stores/settings", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("@/services/lyric/preload", () => ({
  consumePreloadedLyric: mocks.consumePreloadedLyric,
}));
vi.mock("@/services/lyric/resolve", () => ({
  embeddedLyricFromDetail: (detail: { embeddedLyric?: string } | null) =>
    detail?.embeddedLyric
      ? {
          source: { source: "embedded", format: "qrc" },
          content: detail.embeddedLyric,
        }
      : null,
  isBetterFormat: (candidate: LyricFormat, current: LyricFormat | null) => {
    if (!current) return true;
    const order = mocks.settings.lyric.lyricFormatOrder;
    return order.indexOf(candidate) < order.indexOf(current);
  },
  isPluginLyricPreferred: () => mocks.settings.lyric.preferPluginLyric,
  resolveLocalRepoLyric: mocks.resolveLocalRepoLyric,
  resolveOnlineByPreference: mocks.resolveOnlineByPreference,
  resolvePluginLyric: mocks.resolvePluginLyric,
  resolveStreamingByPreference: mocks.resolveStreamingByPreference,
  resolveTTMLOverlay: mocks.resolveTTMLOverlay,
}));
vi.mock("@/core/playerClient", () => ({
  playerClient: { readLyricFile: vi.fn() },
}));

import { loadForTrack, watchLyricPreference } from "./loader";

const makeTrack = (id: string): Track => ({
  id,
  source: "netease",
  title: `Song ${id}`,
  artists: [{ name: "Artist" }],
  duration: 180_000,
});

const lyric = (format: LyricFormat, content: string, platform: Platform = "netease") => ({
  source: { source: "online" as const, format, platform },
  input: { content },
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe("lyric loader", () => {
  beforeEach(() => {
    mocks.media.track = makeTrack("1");
    mocks.media.activeLyric = null;
    mocks.media.lyricContent = null;
    mocks.media.parsedLyric = [];
    mocks.media.resetLyricState.mockReset().mockImplementation(() => {
      mocks.media.activeLyric = null;
      mocks.media.lyricContent = null;
      mocks.media.parsedLyric = [];
    });
    mocks.media.setLyric.mockReset().mockImplementation((source: LyricData, input: LyricInput) => {
      if (source && input && input.content !== "INVALID") {
        mocks.media.activeLyric = source;
        mocks.media.lyricContent = input;
        mocks.media.parsedLyric = [{ words: [{ word: input.content }] }];
        return true;
      }
      if (source && input) return false;
      mocks.media.activeLyric = null;
      mocks.media.lyricContent = null;
      mocks.media.parsedLyric = [];
      return false;
    });
    mocks.settings.lyric.lyricSourcePreference = "auto";
    mocks.settings.lyric.preferPluginLyric = false;
    mocks.consumePreloadedLyric.mockReset().mockResolvedValue({ hit: false });
    mocks.resolveLocalRepoLyric.mockReset().mockResolvedValue(null);
    mocks.resolveOnlineByPreference.mockReset().mockResolvedValue(null);
    mocks.resolvePluginLyric.mockReset().mockResolvedValue(null);
    mocks.resolveStreamingByPreference.mockReset().mockResolvedValue(null);
    mocks.resolveTTMLOverlay.mockReset().mockResolvedValue(null);
    mocks.watch.mockReset();
  });

  it("高质量插件候选先到后不会被低质量平台歌词覆盖", async () => {
    const online = deferred<ReturnType<typeof lyric>>();
    mocks.settings.lyric.preferPluginLyric = true;
    mocks.resolvePluginLyric.mockResolvedValue(lyric("ttml", "plugin"));
    mocks.resolveOnlineByPreference.mockReturnValue(online.promise);

    const loading = loadForTrack(null);
    await flush();
    expect(mocks.media.activeLyric?.format).toBe("ttml");

    online.resolve(lyric("lrc", "platform"));
    await loading;
    expect(mocks.media.lyricContent?.content).toBe("plugin");
  });

  it("显式平台选择允许有效歌词相对本地候选降级", async () => {
    mocks.media.track = { ...makeTrack("local"), source: "local" };
    mocks.settings.lyric.lyricSourcePreference = "netease";
    mocks.resolveOnlineByPreference.mockResolvedValue(lyric("lrc", "preferred platform"));

    await loadForTrack({
      quality: { sampleRate: 44_100, channels: 2, bitsPerSample: 16, bitRate: 0, codec: "flac" },
      externalLyrics: [],
      embeddedLyric: "local qrc",
    });

    expect(mocks.media.activeLyric).toMatchObject({ source: "online", format: "lrc" });
    expect(mocks.media.lyricContent?.content).toBe("preferred platform");
  });

  it("低质量平台歌词先显示，高质量插件返回后立即升级", async () => {
    const plugin = deferred<ReturnType<typeof lyric> | null>();
    mocks.settings.lyric.preferPluginLyric = true;
    mocks.resolvePluginLyric.mockReturnValue(plugin.promise);
    mocks.resolveOnlineByPreference.mockResolvedValue(lyric("lrc", "platform"));

    const loading = loadForTrack(null);
    await flush();
    expect(mocks.media.lyricContent?.content).toBe("platform");

    plugin.resolve(lyric("ttml", "plugin"));
    await loading;
    expect(mocks.media.lyricContent?.content).toBe("plugin");
  });

  it("插件优选请求未完成时不提前提交空歌词", async () => {
    const plugin = deferred<ReturnType<typeof lyric> | null>();
    mocks.settings.lyric.preferPluginLyric = true;
    mocks.resolvePluginLyric.mockReturnValue(plugin.promise);
    mocks.resolveOnlineByPreference.mockResolvedValue(null);

    const loading = loadForTrack(null);
    await flush();
    expect(mocks.media.setLyric).not.toHaveBeenCalled();

    plugin.resolve(lyric("lrc", "plugin"));
    await loading;
    expect(mocks.media.lyricContent?.content).toBe("plugin");
  });

  it("插件优选和普通来源都未命中时最终结束加载", async () => {
    const plugin = deferred<ReturnType<typeof lyric> | null>();
    mocks.settings.lyric.preferPluginLyric = true;
    mocks.resolvePluginLyric.mockReturnValue(plugin.promise);
    mocks.resolveOnlineByPreference.mockResolvedValue(null);

    const loading = loadForTrack(null);
    await flush();
    expect(mocks.media.setLyric).not.toHaveBeenCalled();

    plugin.resolve(null);
    await loading;
    expect(mocks.media.setLyric).toHaveBeenCalledWith(null, null);
  });

  it("TTML 后台升级不阻塞基础歌词，畸形结果也不会清空它", async () => {
    const ttml = deferred<ReturnType<typeof lyric> | null>();
    mocks.resolveOnlineByPreference.mockResolvedValue(lyric("lrc", "base"));
    mocks.resolveTTMLOverlay.mockReturnValue(ttml.promise);

    await loadForTrack(null);
    expect(mocks.media.lyricContent?.content).toBe("base");

    ttml.resolve(lyric("ttml", "INVALID"));
    await flush();
    expect(mocks.media.lyricContent?.content).toBe("base");
  });

  it("消费预载基础歌词后立即展示并在后台升级 TTML", async () => {
    const ttml = deferred<ReturnType<typeof lyric> | null>();
    mocks.consumePreloadedLyric.mockResolvedValue({ hit: true, lyric: lyric("lrc", "preloaded") });
    mocks.resolveTTMLOverlay.mockReturnValue(ttml.promise);

    await loadForTrack(null);
    expect(mocks.media.lyricContent?.content).toBe("preloaded");

    ttml.resolve(lyric("ttml", "upgraded"));
    await flush();
    expect(mocks.media.lyricContent?.content).toBe("upgraded");
  });

  it("预载结果已经是 TTML 时不再安排覆盖请求", async () => {
    mocks.consumePreloadedLyric.mockResolvedValue({ hit: true, lyric: lyric("ttml", "preloaded") });

    await loadForTrack(null);

    expect(mocks.media.lyricContent?.content).toBe("preloaded");
    expect(mocks.resolveTTMLOverlay).not.toHaveBeenCalled();
  });

  it("快速切歌时丢弃旧歌曲的迟到结果", async () => {
    const first = deferred<ReturnType<typeof lyric> | null>();
    mocks.resolveOnlineByPreference.mockImplementation(async (track: Track) =>
      track.id === "1" ? first.promise : lyric("lrc", "second"),
    );

    const firstLoad = loadForTrack(null);
    await flush();
    mocks.media.track = makeTrack("2");
    const secondLoad = loadForTrack(null);
    await secondLoad;
    expect(mocks.media.lyricContent?.content).toBe("second");

    first.resolve(lyric("ttml", "stale"));
    await firstLoad;
    expect(mocks.media.lyricContent?.content).toBe("second");
  });

  it("流媒体刷新显式平台偏好时允许有效歌词降级", async () => {
    mocks.media.track = {
      ...makeTrack("streaming"),
      source: "streaming",
      serverId: "server-1",
      originalId: "original-1",
    };
    mocks.media.activeLyric = { source: "online", format: "qrc", platform: "qqmusic" };
    mocks.media.lyricContent = { content: "old qrc" };
    mocks.media.parsedLyric = [{ words: [{ word: "old qrc" }] }];
    mocks.settings.lyric.lyricSourcePreference = "netease";
    mocks.resolveStreamingByPreference.mockResolvedValue(lyric("lrc", "preferred lrc"));
    mocks.watch.mockImplementation((_source, callback) => {
      callback();
      return vi.fn();
    });

    watchLyricPreference();
    await vi.waitFor(() => expect(mocks.media.lyricContent?.content).toBe("preferred lrc"));

    expect(mocks.media.activeLyric).toMatchObject({ format: "lrc", platform: "netease" });
  });

  it("流媒体显式平台未命中时不允许较差的回退平台歌词降级", async () => {
    mocks.media.track = {
      ...makeTrack("streaming-fallback"),
      source: "streaming",
      serverId: "server-1",
      originalId: "original-1",
    };
    mocks.media.activeLyric = { source: "online", format: "qrc", platform: "qqmusic" };
    mocks.media.lyricContent = { content: "old qrc" };
    mocks.media.parsedLyric = [{ words: [{ word: "old qrc" }] }];
    mocks.settings.lyric.lyricSourcePreference = "netease";
    mocks.resolveStreamingByPreference.mockResolvedValue(lyric("lrc", "fallback lrc", "qqmusic"));
    mocks.watch.mockImplementation((_source, callback) => {
      callback();
      return vi.fn();
    });

    watchLyricPreference();
    await vi.waitFor(() => expect(mocks.resolveStreamingByPreference).toHaveBeenCalledOnce());
    await flush();

    expect(mocks.media.activeLyric).toMatchObject({ format: "qrc", platform: "qqmusic" });
    expect(mocks.media.lyricContent?.content).toBe("old qrc");
  });
});
