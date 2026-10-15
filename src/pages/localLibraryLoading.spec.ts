import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { h, KeepAlive, ref, type Component } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { AlbumSummary, LibraryApi } from "@shared/types/library";
import type { IpcResponse, Track } from "@shared/types/player";
import messages from "@/i18n/locales/zh-CN.json";
import { useLibraryStore } from "@/stores/library";
import type { subscribeCoreControlEvent } from "@/core/controlEventClient";
import LocalList from "./LocalList.vue";
import Songs from "./Songs.vue";

const mocks = vi.hoisted(() => ({
  route: { name: "album-list" },
  getItem: vi.fn<(key: string) => Promise<unknown>>(),
  setItem: vi.fn().mockResolvedValue(undefined),
  getTracks: vi.fn<LibraryApi["getTracks"]>(),
  getAlbums: vi.fn<LibraryApi["getAlbums"]>(),
  getArtists: vi.fn<LibraryApi["getArtists"]>(),
  getScanDirs: vi.fn<LibraryApi["getScanDirs"]>(),
  getLikedTrackIds: vi.fn<LibraryApi["getLikedTrackIds"]>(),
  isScanning: vi.fn<LibraryApi["isScanning"]>(),
  prefetchArtistAvatars: vi.fn<LibraryApi["prefetchArtistAvatars"]>(),
  subscribe: vi.fn<typeof subscribeCoreControlEvent>(() => () => {}),
}));

vi.mock("localforage", () => ({
  default: { createInstance: () => ({ getItem: mocks.getItem, setItem: mocks.setItem }) },
}));
vi.mock("@/core/libraryClient", () => ({ libraryClient: mocks }));
vi.mock("@/core/controlEventClient", () => ({
  subscribeCoreControlEvent: mocks.subscribe,
}));
vi.mock("@/settings/useSettingsDialog", () => ({
  useSettingsDialog: () => ({ show: vi.fn() }),
}));
vi.mock("@/utils/navigate", () => ({ navigateToAlbum: vi.fn(), navigateToArtist: vi.fn() }));
vi.mock("@/core/player", () => ({ playFrom: vi.fn() }));
vi.mock("vue-router", () => ({ useRoute: () => mocks.route }));
vi.mock("@/components/list/CoverList.vue", () => ({
  default: { props: ["items"], template: "<div data-list>{{ items }}</div>" },
}));
vi.mock("@/components/list/SongList.vue", () => ({
  default: { props: ["items"], template: "<div data-list>{{ items }}</div>" },
}));

const track: Track = {
  id: "local:1",
  source: "local",
  title: "缓存歌曲",
  artists: [],
  duration: 1000,
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const wrappers: VueWrapper[] = [];
const mountPage = (component: Component) => {
  const wrapper = mount(component, {
    global: {
      plugins: [createI18n({ legacy: false, locale: "zh-CN", messages: { "zh-CN": messages } })],
      stubs: {
        CoverList: false,
        SongList: false,
        Songs: false,
        LocalList: false,
        SButton: {
          props: { disabled: Boolean, loading: Boolean },
          template: '<button :disabled="disabled || loading"><slot /></button>',
        },
        SInput: {
          props: { modelValue: String },
          emits: ["update:modelValue"],
          template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        SSelect: true,
        SLoading: true,
        IconLucideSearch: true,
        IconLucideSettings2: true,
        IconLucideMusic: true,
        IconLucideHardDrive: true,
        IconLucidePlay: true,
        IconLucideListChecks: true,
      },
    },
  });
  wrappers.push(wrapper);
  return wrapper;
};

const expectLoading = (wrapper: VueWrapper) => {
  expect(wrapper.find('[role="status"]').exists()).toBe(true);
  expect(wrapper.text()).not.toContain("暂无本地");
  expect(wrapper.text()).not.toContain("打开本地曲库设置");
};

const retry = async (wrapper: VueWrapper) => {
  const button = wrapper.findAll("button").find((item) => item.text() === "重试");
  expect(button).toBeDefined();
  await button!.trigger("click");
};

beforeEach(() => {
  setActivePinia(createPinia());
  mocks.getItem.mockReset().mockResolvedValue(null);
  mocks.getTracks.mockReset().mockResolvedValue({ success: true, data: [] });
  mocks.getAlbums.mockReset().mockResolvedValue({ success: true, data: [] });
  mocks.getArtists.mockReset().mockResolvedValue({ success: true, data: [] });
  mocks.getScanDirs.mockReset().mockResolvedValue({ success: true, data: [] });
  mocks.getLikedTrackIds.mockReset().mockResolvedValue({ success: true, data: [] });
  mocks.isScanning.mockReset().mockResolvedValue({ success: true, data: false });
  mocks.prefetchArtistAvatars.mockReset().mockResolvedValue({ success: false, error: "offline" });
});

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
});

describe.each([
  {
    route: "album-list",
    empty: "暂无本地专辑",
    api: mocks.getAlbums,
    item: { id: "album:1", name: "测试专辑", artist: "艺术家", trackCount: 1, addedAt: 1 },
  },
  {
    route: "artist-list",
    empty: "暂无本地艺术家",
    api: mocks.getArtists,
    item: { id: "album:1", name: "测试艺术家", artist: "艺术家", trackCount: 1, addedAt: 1 },
  },
])("本地列表 $route", ({ route, empty, api, item }) => {
  beforeEach(() => {
    mocks.route.name = route;
  });

  it("请求完成前显示加载中，成功后显示列表", async () => {
    const response = deferred<IpcResponse<AlbumSummary[]>>();
    api.mockReturnValueOnce(response.promise);
    const wrapper = mountPage(LocalList);
    expectLoading(wrapper);
    response.resolve({ success: true, data: [item] });
    await flushPromises();
    expect(wrapper.find("[data-list]").text()).toContain(item.name);
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain(empty);
  });

  it("只有成功返回空列表才显示空库设置入口", async () => {
    const wrapper = mountPage(LocalList);
    expectLoading(wrapper);
    await flushPromises();
    expect(wrapper.text()).toContain(empty);
    expect(wrapper.text()).toContain("打开本地曲库设置");
  });

  it("请求失败显示错误，重试期间保持加载状态且可恢复", async () => {
    api.mockResolvedValueOnce({ success: false, error: "offline" });
    const wrapper = mountPage(LocalList);
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain("加载失败");
    expect(wrapper.text()).not.toContain(empty);
    const response = deferred<IpcResponse<AlbumSummary[]>>();
    api.mockReturnValueOnce(response.promise);
    await retry(wrapper);
    expectLoading(wrapper);
    response.resolve({ success: true, data: [item] });
    await flushPromises();
    expect(wrapper.find("[data-list]").text()).toContain(item.name);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it("搜索无匹配不显示空库提示", async () => {
    api.mockResolvedValueOnce({ success: true, data: [item] });
    const wrapper = mountPage(LocalList);
    await flushPromises();
    await wrapper.find("input").setValue("不存在的条目");
    expect(wrapper.text()).toContain("没有匹配的");
    expect(wrapper.text()).not.toContain(empty);
  });
});

describe("歌曲列表加载", () => {
  it("缓存读取期间和 Core 请求期间都不显示空库提示", async () => {
    const cache = deferred<null>();
    const response = deferred<IpcResponse<Track[]>>();
    mocks.getItem.mockReturnValue(cache.promise);
    mocks.getTracks.mockReturnValue(response.promise);
    const wrapper = mountPage(Songs);
    expectLoading(wrapper);
    cache.resolve(null);
    await flushPromises();
    expectLoading(wrapper);
    response.resolve({ success: true, data: [track] });
    await flushPromises();
    expect(wrapper.find("[data-list]").text()).toContain(track.title);
    expect(useLibraryStore().tracksLoadState).toBe("success");
  });

  it("成功返回空列表后才显示暂无本地歌曲", async () => {
    const wrapper = mountPage(Songs);
    expectLoading(wrapper);
    await flushPromises();
    expect(wrapper.text()).toContain("暂无本地歌曲");
    expect(wrapper.text()).toContain("打开本地曲库设置");
  });

  it("首次请求失败后，即使 initialized 已置位仍能重试", async () => {
    mocks.getTracks.mockResolvedValueOnce({ success: false, error: "offline" });
    const wrapper = mountPage(Songs);
    await flushPromises();
    expect(useLibraryStore().initialized).toBe(true);
    expect(wrapper.find('[role="alert"]').text()).toContain("加载失败");
    expect(wrapper.text()).not.toContain("暂无本地歌曲");
    mocks.getTracks.mockResolvedValueOnce({ success: true, data: [track] });
    await retry(wrapper);
    await flushPromises();
    expect(wrapper.find("[data-list]").text()).toContain(track.title);
  });

  it("重新进入失败页面会重新加载", async () => {
    mocks.getTracks.mockResolvedValueOnce({ success: false, error: "offline" });
    const first = mountPage(Songs);
    await flushPromises();
    first.unmount();
    mocks.getTracks.mockResolvedValueOnce({ success: true, data: [track] });
    const wrapper = mountPage(Songs);
    await flushPromises();
    expect(wrapper.find("[data-list]").text()).toContain(track.title);
  });

  it("缓存非空时立即展示，刷新失败保留缓存并提供重试", async () => {
    const response = deferred<IpcResponse<Track[]>>();
    mocks.getItem.mockImplementation(async (key) => (key === "tracks" ? [track] : null));
    mocks.getTracks.mockReturnValueOnce(response.promise);
    const wrapper = mountPage(Songs);
    await flushPromises();
    expect(wrapper.find("[data-list]").text()).toContain(track.title);
    expect(wrapper.text()).not.toContain("暂无本地歌曲");
    response.resolve({ success: false, error: "offline" });
    await flushPromises();
    expect(wrapper.find("[data-list]").text()).toContain(track.title);
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    await retry(wrapper);
    await flushPromises();
    expect(wrapper.text()).toContain("暂无本地歌曲");
    expect(useLibraryStore().tracksLoadState).toBe("success");
  });

  it("Core 成功返回空数组会替换非空缓存", async () => {
    mocks.getItem.mockImplementation(async (key) => (key === "tracks" ? [track] : null));
    const wrapper = mountPage(Songs);
    await flushPromises();
    expect(wrapper.find("[data-list]").exists()).toBe(false);
    expect(wrapper.text()).toContain("暂无本地歌曲");
    expect(mocks.setItem).toHaveBeenCalledWith("tracks", []);
  });

  it("缓存损坏不阻止 Core 成功加载", async () => {
    mocks.getItem.mockRejectedValue(new Error("IndexedDB unavailable"));
    mocks.getTracks.mockResolvedValueOnce({ success: true, data: [track] });
    const wrapper = mountPage(Songs);
    await flushPromises();
    expect(wrapper.find("[data-list]").text()).toContain(track.title);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it("曲目成功与否不由目录、红心、扫描状态或头像结果决定", async () => {
    mocks.getScanDirs.mockResolvedValueOnce({ success: false, error: "dirs failed" });
    mocks.getLikedTrackIds.mockResolvedValueOnce({ success: false, error: "likes failed" });
    mocks.isScanning.mockResolvedValueOnce({ success: false, error: "scan failed" });
    mocks.getArtists.mockResolvedValueOnce({ success: false, error: "avatars failed" });
    const wrapper = mountPage(Songs);
    await flushPromises();
    expect(useLibraryStore().tracksLoadState).toBe("success");
    expect(wrapper.text()).toContain("暂无本地歌曲");
  });

  it("目录请求尚未完成时，曲目请求成功就能确认空库", async () => {
    const dirs = deferred<IpcResponse<string[]>>();
    mocks.getScanDirs.mockReturnValueOnce(dirs.promise);
    const wrapper = mountPage(Songs);
    await flushPromises();
    expect(useLibraryStore().initialized).toBe(false);
    expect(useLibraryStore().tracksLoadState).toBe("success");
    expect(wrapper.text()).toContain("暂无本地歌曲");
    dirs.resolve({ success: true, data: [] });
    await flushPromises();
  });

  it("扫描完成后的刷新也区分加载、失败和恢复", async () => {
    const wrapper = mountPage(Songs);
    await flushPromises();
    const scanListener = mocks.subscribe.mock.calls.find(
      ([type]) => type === "libraryScanProgress",
    )?.[1];
    const changeListener = mocks.subscribe.mock.calls.find(
      ([type]) => type === "libraryChanged",
    )?.[1];
    expect(scanListener).toBeDefined();
    expect(changeListener).toBeDefined();
    const response = deferred<IpcResponse<Track[]>>();
    mocks.getTracks.mockReturnValueOnce(response.promise);
    scanListener!({ phase: "done", total: 1, scanned: 1 });
    await flushPromises();
    expectLoading(wrapper);
    response.resolve({ success: false, error: "offline" });
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("暂无本地歌曲");
    mocks.getTracks.mockResolvedValueOnce({ success: true, data: [track] });
    changeListener!({ revision: 1 });
    await flushPromises();
    expect(wrapper.find("[data-list]").text()).toContain(track.title);
    expect(useLibraryStore().tracksLoadState).toBe("success");
  });
});

describe.each([
  { route: "album-list", component: LocalList, api: mocks.getAlbums },
  { route: "artist-list", component: LocalList, api: mocks.getArtists },
  { route: "songs", component: Songs, api: mocks.getTracks },
])("页面缓存 $route", ({ route, component, api }) => {
  it("首次挂载不重复请求，失败后从 KeepAlive 返回可重新加载", async () => {
    mocks.route.name = route;
    api.mockResolvedValueOnce({ success: false, error: "offline" });
    const active = ref(true);
    const wrapper = mountPage({
      setup: () => () =>
        h(KeepAlive, null, { default: () => (active.value ? h(component) : null) }),
    });
    await flushPromises();
    expect(api).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    active.value = false;
    await flushPromises();
    const response = deferred<IpcResponse<[]>>();
    api.mockReturnValueOnce(response.promise);
    active.value = true;
    await flushPromises();
    expect(api).toHaveBeenCalledTimes(2);
    expectLoading(wrapper);
    response.resolve({ success: true, data: [] });
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("暂无本地");
    const completedCalls = api.mock.calls.length;
    active.value = false;
    await flushPromises();
    active.value = true;
    await flushPromises();
    expect(api).toHaveBeenCalledTimes(completedCalls);
  });
});

describe("聚合结果与头像调用点", () => {
  it("Store 保留专辑、艺术家接口的失败结果", async () => {
    const failure = { success: false, error: "offline" };
    mocks.getAlbums.mockResolvedValueOnce(failure);
    mocks.getArtists.mockResolvedValueOnce(failure);
    const store = useLibraryStore();
    expect(await store.getAlbumList()).toEqual(failure);
    expect(await store.getArtistList()).toEqual(failure);
  });

  it("艺术家查询失败不触发头像预取", async () => {
    mocks.getArtists.mockResolvedValueOnce({ success: false, error: "offline" });
    await expect(useLibraryStore().loadArtistAvatars()).resolves.toBeUndefined();
    expect(mocks.prefetchArtistAvatars).not.toHaveBeenCalled();
  });

  it("头像预取失败不影响已经成功加载的艺术家列表", async () => {
    mocks.route.name = "artist-list";
    mocks.getArtists.mockResolvedValue({
      success: true,
      data: [{ name: "艺术家", trackCount: 1 }],
    });
    const wrapper = mountPage(LocalList);
    await flushPromises();
    expect(mocks.prefetchArtistAvatars).toHaveBeenCalled();
    expect(wrapper.find("[data-list]").text()).toContain("艺术家");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it("头像 HTTP 请求拒绝也不影响艺术家列表或产生未处理的异常", async () => {
    mocks.route.name = "artist-list";
    mocks.getArtists.mockResolvedValue({
      success: true,
      data: [{ name: "艺术家", trackCount: 1 }],
    });
    mocks.prefetchArtistAvatars.mockRejectedValue(new Error("HTTP 500"));
    const wrapper = mountPage(LocalList);
    await flushPromises();
    expect(wrapper.find("[data-list]").text()).toContain("艺术家");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
});
