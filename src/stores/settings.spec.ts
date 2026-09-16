import { describe, expect, it } from "vitest";
import { DEFAULT_SIDEBAR_NAV_GROUPS } from "@/types/settings";
import { reconcileHiddenKeys, reconcileNavGroups } from "./settings";

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

  it("自定义布局只原位替换旧音乐库入口，不改变用户顺序", () => {
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

    expect(result[0]).toEqual({
      name: "本地",
      showName: true,
      keys: ["/", "/artists/local", "/songs", "/albums/local"],
    });
  });

  it("隐藏状态同步把旧音乐库入口迁移到歌曲", () => {
    expect(reconcileHiddenKeys(["/library", "/stats"])).toEqual(["/songs", "/stats"]);
  });
});
