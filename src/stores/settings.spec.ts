import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createApp } from "vue";
import piniaPersistedstate from "pinia-plugin-persistedstate";
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

describe("browser presentation persistence migration", () => {
  beforeEach(() => {
    const entries = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["default", "classic"],
    ["fullscreen", "fullCover"],
    [undefined, "classic"],
  ])("migrates legacy coverLayout %s into %s", (legacy, expected) => {
    localStorage.setItem("settings", JSON.stringify({ player: { coverLayout: legacy } }));
    const pinia = createPinia();
    pinia.use(piniaPersistedstate);
    createApp(() => null).use(pinia);
    setActivePinia(pinia);

    const settings = useSettingsStore();
    expect(settings.player.layout).toBe(expected);
    const persisted = JSON.parse(localStorage.getItem("settings") || "{}") as {
      player?: Record<string, unknown>;
    };
    expect(persisted.player?.layout).toBe(expected);
    expect(persisted.player).not.toHaveProperty("coverLayout");
    localStorage.removeItem("settings");
  });

  it("retains the new layout rather than restoring the legacy cover preference", () => {
    localStorage.setItem(
      "settings",
      JSON.stringify({ player: { layout: "apple", coverLayout: "fullscreen" } }),
    );
    const pinia = createPinia();
    pinia.use(piniaPersistedstate);
    createApp(() => null).use(pinia);
    setActivePinia(pinia);

    const settings = useSettingsStore();
    expect(settings.player.layout).toBe("apple");
    const persisted = JSON.parse(localStorage.getItem("settings") || "{}") as {
      player?: Record<string, unknown>;
    };
    expect(persisted.player?.layout).toBe("apple");
    expect(persisted.player).not.toHaveProperty("coverLayout");
    localStorage.removeItem("settings");
  });

  it("restores compact density and page-scoped sort without leaking arbitrary keys", () => {
    localStorage.setItem(
      "settings",
      JSON.stringify({
        appearance: {
          songListDensity: "compact",
          songSortPreferences: {
            songs: { field: "title", order: "desc" },
            album: { field: "track", order: "asc" },
            "playlist:individual": { field: "artist", order: "asc" },
          },
        },
      }),
    );
    const pinia = createPinia();
    pinia.use(piniaPersistedstate);
    createApp(() => null).use(pinia);
    setActivePinia(pinia);
    const settings = useSettingsStore();
    expect(settings.appearance.songListDensity).toBe("compact");
    expect(settings.appearance.songSortPreferences).toEqual({
      songs: { field: "title", order: "desc" },
      album: { field: "track", order: "asc" },
    });
    expect(
      JSON.parse(localStorage.getItem("settings") ?? "{}").appearance.songSortPreferences,
    ).toEqual({
      songs: { field: "title", order: "desc" },
      album: { field: "track", order: "asc" },
    });
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
