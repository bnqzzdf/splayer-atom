import { describe, expect, it } from "vitest";
import {
  homeItemToCoverItem,
  qobuzAudioBadge,
  qobuzSectionEndpoint,
  tidalAudioBadge,
  tidalModulePath,
  toQobuzItem,
  toTidalItem,
  type HomeItem,
} from "./platformHome";

describe("Qobuz 音质角标", () => {
  // 形状取自线上 discover/index 的真实条目：每个专辑都带 audio_info
  it("24 位或采样率高于 48k 判为 Hi-Res", () => {
    expect(
      qobuzAudioBadge({ audio_info: { maximum_bit_depth: 24, maximum_sampling_rate: 96 } }),
    ).toBe("Hi-Res");
    expect(
      qobuzAudioBadge({ audio_info: { maximum_bit_depth: 24, maximum_sampling_rate: 44.1 } }),
    ).toBe("Hi-Res");
    expect(
      qobuzAudioBadge({ audio_info: { maximum_bit_depth: 16, maximum_sampling_rate: 96 } }),
    ).toBe("Hi-Res");
  });

  it("CD 规格不打标", () => {
    expect(
      qobuzAudioBadge({ audio_info: { maximum_bit_depth: 16, maximum_sampling_rate: 44.1 } }),
    ).toBeUndefined();
  });

  it("字段缺失时不猜", () => {
    expect(qobuzAudioBadge({ title: "只有标题" })).toBeUndefined();
    expect(qobuzAudioBadge({ audio_info: {} })).toBeUndefined();
    expect(qobuzAudioBadge(null)).toBeUndefined();
  });

  it("角标会带到归一化后的条目上", () => {
    const item = toQobuzItem({
      id: 1,
      title: "Memory Bomb",
      track_count: 10,
      audio_info: { maximum_bit_depth: 24, maximum_sampling_rate: 96 },
    });
    expect(item?.badge).toBe("Hi-Res");
    expect(item?.kind).toBe("album");
  });
});

describe("TIDAL 音质角标", () => {
  it("以 mediaMetadata.tags 为准", () => {
    expect(tidalAudioBadge({ mediaMetadata: { tags: ["LOSSLESS", "HIRES_LOSSLESS"] } })).toBe(
      "Hi-Res",
    );
    expect(tidalAudioBadge({ mediaMetadata: { tags: ["DOLBY_ATMOS"] } })).toBe("Atmos");
  });

  it("audioQuality 只写当前档，不能据此漏掉 Hi-Res", () => {
    // 实测线上：audioQuality=LOSSLESS 而 tags 里已经有 HIRES_LOSSLESS
    expect(
      tidalAudioBadge({ audioQuality: "LOSSLESS", mediaMetadata: { tags: ["LOSSLESS"] } }),
    ).toBeUndefined();
    expect(tidalAudioBadge({ audioQuality: "HI_RES_LOSSLESS" })).toBe("Hi-Res");
    expect(tidalAudioBadge({})).toBeUndefined();
  });

  it("专辑条目也能拿到角标", () => {
    const item = toTidalItem(
      {
        id: 564082191,
        title: "The Life of a Showgirl",
        cover: "39e3dad3",
        mediaMetadata: { tags: ["LOSSLESS", "HIRES_LOSSLESS"] },
      },
      "ALBUM_LIST",
    );
    expect(item?.badge).toBe("Hi-Res");
    expect(item?.kind).toBe("album");
  });
});

describe("分区翻页定位", () => {
  it("Qobuz 只给白名单里的容器映射端点名", () => {
    expect(qobuzSectionEndpoint("new_releases")).toBe("newReleases");
    expect(qobuzSectionEndpoint("press_awards")).toBe("pressAward");
    expect(qobuzSectionEndpoint("album_of_the_week")).toBe("albumOfTheWeek");
    // 平台本身没有更多条目的容器不该给出入口，否则点进去只会报错
    expect(qobuzSectionEndpoint("playlists_tags")).toBeUndefined();
    expect(qobuzSectionEndpoint("banners")).toBeUndefined();
    expect(qobuzSectionEndpoint("recent_releases")).toBeUndefined();
  });

  it("TIDAL 的 dataApiPath 去掉 pages/ 前缀后交给 pages_get", () => {
    expect(tidalModulePath({ dataApiPath: "pages/data/b047c1c8-9512-4244" })).toBe(
      "data/b047c1c8-9512-4244",
    );
    // 没有模块路径就没有可翻页的入口
    expect(tidalModulePath({})).toBeUndefined();
    // 只剩一个 uuid 无法拼出端点，同样不给入口
    expect(tidalModulePath({ dataApiPath: "b047c1c8-9512" })).toBeUndefined();
  });
});

describe("卡片映射", () => {
  it("角标随条目一起进卡片", () => {
    const item: HomeItem = { id: "1", title: "x", kind: "album", badge: "Hi-Res" };
    expect(homeItemToCoverItem(item)).toMatchObject({
      id: "1",
      title: "x",
      badge: "Hi-Res",
      trackCount: 0,
    });
  });

  it("没有音质信息时不产生角标字段", () => {
    const item: HomeItem = { id: "2", title: "y", kind: "playlist" };
    expect(homeItemToCoverItem(item).badge).toBeUndefined();
  });
});
