import { describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { DEFAULT_SIDEBAR_NAV_GROUPS } from "@/types/settings";
import { reconcileHiddenKeys, reconcileNavGroups, useSettingsStore } from "./settings";

describe("folder browse display preference", () => {
  it("defaults to the existing filename ascending presentation", () => {
    setActivePinia(createPinia());
    const settings = useSettingsStore();
    expect(settings.appearance.folderBrowseSort).toBe("name");
    expect(settings.appearance.folderBrowseOrder).toBe("asc");
  });
});

describe("sidebar navigation migration", () => {
  it("将旧默认本地浏览顺序升级为首页、专辑、艺术家、歌曲", () => {
    const result = reconcileNavGroups([
      {
        name: "",
        showName: false,
        keys: ["/", "/library", "/artists/local", "/albums/local", "/folders", "/stats"],
      },
      {
        name: "",
        showName: false,
        keys: ["/liked", "/favorites", "/cloud", "/download", "/streaming", "/history"],
      },
    ]);

    expect(result[0].keys).toEqual(DEFAULT_SIDEBAR_NAV_GROUPS[0].keys);
  });

  it("自定义布局只原位替换旧音乐库入口，并把新引入的在线平台放到首页之后", () => {
    const result = reconcileNavGroups([
      {
        name: "本地",
        showName: true,
        keys: ["/", "/artists/local", "/library", "/albums/local"],
      },
      {
        name: "其他",
        showName: false,
        keys: [
          "/folders",
          "/stats",
          "/liked",
          "/favorites",
          "/cloud",
          "/download",
          "/streaming",
          "/history",
        ],
      },
    ]);

    // 用户已有的项顺序不变（/library → /songs 原位替换）；
    // /platforms 是本版本新引入的项，首次出现时定位到首页之后。
    expect(result[0]).toEqual({
      name: "本地",
      showName: true,
      keys: ["/", "/platforms", "/artists/local", "/songs", "/albums/local"],
    });
  });

  it("用户调整过在线平台位置后，迁移不再干预其顺序", () => {
    const result = reconcileNavGroups([
      {
        name: "",
        showName: false,
        // 用户已把它拖到歌曲之后
        keys: ["/", "/albums/local", "/songs", "/platforms"],
      },
      { name: "", showName: false, keys: ["/folders", "/stats"] },
    ]);

    expect(result[0].keys.indexOf("/platforms")).toBe(3);
    expect(result[0].keys.indexOf("/songs")).toBe(2);
  });

  it("隐藏状态同步把旧音乐库入口迁移到歌曲", () => {
    expect(reconcileHiddenKeys(["/library", "/stats"])).toEqual(["/songs", "/stats"]);
  });
});
