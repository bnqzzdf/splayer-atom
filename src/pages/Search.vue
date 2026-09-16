<script setup lang="ts">
defineOptions({ name: "SearchPage" });

import type { AlbumSummary, ArtistSummary } from "@shared/types/library";
import type { Track } from "@shared/types/player";
import { ALL_PLATFORMS, PLATFORM_SHORT_NAME, type Platform } from "@shared/types/platform";
import type { CoverItem } from "@/types/artist";
import { searchSongs, searchAlbums, searchArtists, searchPlaylists } from "@/apis/search";
import SongList from "@/components/list/SongList.vue";
import CoverList from "@/components/list/CoverList.vue";
import StreamingLoginDialog from "@/components/modals/StreamingLoginDialog.vue";
import IconLucideLogIn from "~icons/lucide/log-in";
import { useStatusStore } from "@/stores/status";
import { useProviderSessionsStore } from "@/stores/providerSessions";
import { useStreamingStore } from "@/stores/streaming";
import { navigateToAlbum, navigateToArtist, navigateToPlaylist } from "@/utils/navigate";
import { libraryClient } from "@/core/libraryClient";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const status = useStatusStore();
const providerSessions = useProviderSessionsStore();
const streaming = useStreamingStore();
const atomSearchPlatforms = new Set<Platform>(["netease", "qobuz", "tidal"]);
if (!atomSearchPlatforms.has(status.searchPlatform)) status.searchPlatform = "netease";
void streaming.init();

type SearchSource = Platform | "local" | "streaming";
type TabKey = "songs" | "albums" | "artists" | "playlists";

const TAB_KEYS: readonly TabKey[] = ["songs", "albums", "artists", "playlists"];

const PAGE_SIZE = 50;

/** 当前生效的 tab */
const activeTab = ref<TabKey>("songs");

/** 当前生效的关键词 */
const keyword = ref("");
/** Web Control 默认优先搜索 Core 本地曲库。 */
const searchSource = ref<SearchSource>("local");

const tabs = computed(() => {
  const items = [
    { key: "songs", label: t("search.tabs.songs") },
    { key: "albums", label: t("search.tabs.albums") },
    { key: "artists", label: t("search.tabs.artists") },
    { key: "playlists", label: t("search.tabs.playlists") },
  ];
  if (searchSource.value === "local") return items.slice(0, 3);
  return items;
});

/** NCM 搜索允许匿名使用；Qobuz/TIDAL 仅在 Core 会话已认证时进入搜索来源。 */
const isSearchPlatformAvailable = (platform: Platform): boolean =>
  platform === "netease" ||
  ((platform === "qobuz" || platform === "tidal") && providerSessions.isAuthenticated(platform));

const platformTabs = computed(() => {
  const online = ALL_PLATFORMS.filter(
    (key) => atomSearchPlatforms.has(key) && isSearchPlatformAvailable(key),
  ).map((key) => ({ key, label: PLATFORM_SHORT_NAME[key] }));
  const mediaSource = streaming.activeServer
    ? [{ key: "streaming", label: t("search.source.streaming") }]
    : [];
  return [{ key: "local", label: t("search.source.local") }, ...mediaSource, ...online];
});

watch(
  () =>
    [
      providerSessions.initialized,
      providerSessions.sessions.qobuz.authenticated,
      providerSessions.sessions.tidal.authenticated,
    ] as const,
  ([initialized]) => {
    if (!initialized) return;
    const source = searchSource.value;
    if ((source === "qobuz" || source === "tidal") && !providerSessions.isAuthenticated(source)) {
      searchSource.value = "local";
    }
  },
  { immediate: true },
);

watch(
  () => streaming.activeServerId,
  (serverId) => {
    if (!serverId && searchSource.value === "streaming") searchSource.value = "local";
  },
);

interface TabState<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
}

const createState = <T,>(): TabState<T> => ({
  items: [],
  total: 0,
  hasMore: false,
  loaded: false,
  loading: false,
  loadingMore: false,
});

const states = reactive({
  songs: createState<Track>(),
  albums: createState<CoverItem>(),
  artists: createState<CoverItem>(),
  playlists: createState<CoverItem>(),
});

const error = ref("");
/** 关键词或平台切换时递增，丢弃仍在途中的旧平台搜索结果。 */
let searchGeneration = 0;

/** 派发到 apis 层的统一调用 */
const fetchers = {
  songs: searchSongs,
  albums: searchAlbums,
  artists: searchArtists,
  playlists: searchPlaylists,
} as const;

/**
 * 拉取指定 tab
 * @param tab - 要拉取的 tab
 * @param append - 是否追加下一页
 */
const fetchTab = async (tab: TabKey, append: boolean): Promise<void> => {
  if (!keyword.value) return;
  const state = states[tab];
  if (append) {
    if (!state.loaded || state.loadingMore || !state.hasMore) return;
    state.loadingMore = true;
  } else {
    if (state.loading) return;
    state.loading = true;
  }
  error.value = "";
  const generation = searchGeneration;
  const requestSource = searchSource.value;
  const requestKeyword = keyword.value;
  try {
    const offset = append ? state.items.length : 0;
    let result: { items: Array<Track | CoverItem>; total: number; hasMore: boolean };
    if (requestSource === "local") {
      let all: Array<Track | CoverItem>;
      if (tab === "songs") {
        const response = await libraryClient.searchTracks(requestKeyword);
        if (!response.success) throw new Error(response.error ?? "LOCAL_SEARCH_FAILED");
        all = response.data ?? [];
      } else if (tab === "albums") {
        const response = await libraryClient.getAlbums();
        if (!response.success) throw new Error(response.error ?? "LOCAL_SEARCH_FAILED");
        const needle = requestKeyword.toLocaleLowerCase();
        all = (response.data ?? [])
          .filter(
            (album: AlbumSummary) =>
              album.name.toLocaleLowerCase().includes(needle) ||
              album.artist.toLocaleLowerCase().includes(needle),
          )
          .map((album: AlbumSummary) => ({
            id: album.id,
            title: album.name,
            cover: album.cover,
            subtitle: album.artist,
            trackCount: album.trackCount,
          }));
      } else if (tab === "artists") {
        const response = await libraryClient.getArtists();
        if (!response.success) throw new Error(response.error ?? "LOCAL_SEARCH_FAILED");
        const needle = requestKeyword.toLocaleLowerCase();
        all = (response.data ?? [])
          .filter((artist: ArtistSummary) => artist.name.toLocaleLowerCase().includes(needle))
          .map((artist: ArtistSummary) => ({
            id: artist.name,
            title: artist.name,
            cover: artist.cover,
            trackCount: artist.trackCount,
          }));
      } else {
        all = [];
      }
      const items = all.slice(offset, offset + PAGE_SIZE);
      result = { items, total: all.length, hasMore: offset + items.length < all.length };
    } else if (requestSource === "streaming") {
      const response = await streaming.search(requestKeyword);
      let all: Array<Track | CoverItem>;
      if (tab === "songs") {
        all = response.songs;
      } else if (tab === "albums") {
        all = response.albums.map((album) => ({
          id: album.id ?? album.name,
          title: album.name,
          subtitle: album.artist,
          cover: album.cover,
          trackCount: album.trackCount ?? 0,
        }));
      } else if (tab === "artists") {
        all = response.artists.map((artist) => ({
          id: artist.id ?? artist.name,
          title: artist.name,
          cover: artist.avatar,
          trackCount: artist.albumCount ?? 0,
        }));
      } else {
        all = response.playlists.map((playlist) => ({
          id: playlist.id ?? playlist.name,
          title: playlist.name,
          subtitle: playlist.description,
          cover: playlist.cover,
          trackCount: playlist.trackCount ?? 0,
        }));
      }
      const items = all.slice(offset, offset + PAGE_SIZE);
      result = { items, total: all.length, hasMore: offset + items.length < all.length };
    } else {
      result = await (fetchers[tab] as typeof searchSongs)(
        requestSource,
        requestKeyword,
        offset,
        PAGE_SIZE,
      );
    }
    if (
      generation !== searchGeneration ||
      requestSource !== searchSource.value ||
      requestKeyword !== keyword.value
    ) {
      return;
    }
    const items = result.items.map((item) => markRaw(item));
    if (append) {
      (state.items as Track[]).push(...(items as Track[]));
    } else {
      state.items = items as Track[];
    }
    state.total = result.total;
    state.hasMore = result.hasMore;
    state.loaded = true;
  } catch (err) {
    if (generation === searchGeneration) {
      error.value = err instanceof Error ? err.message : String(err);
    }
  } finally {
    if (generation === searchGeneration) {
      state.loading = false;
      state.loadingMore = false;
    }
  }
};

const resetStates = (): void => {
  searchGeneration++;
  (Object.keys(states) as TabKey[]).forEach((tab) => {
    states[tab].items = [];
    states[tab].total = 0;
    states[tab].hasMore = false;
    states[tab].loaded = false;
    states[tab].loading = false;
    states[tab].loadingMore = false;
  });
  error.value = "";
};

let lastLoadedKeyword = "";
let lastLoadedSource = searchSource.value;
let lastLoadedStreamingServerId = streaming.activeServerId;

/** 仅在当前处于搜索路由时同步路由参数，避免离开到其他页面时因 query 为空而误清空状态 */
const syncFromRoute = (): void => {
  if (route.name !== "search") return;
  const q = typeof route.query.q === "string" ? route.query.q.trim() : "";
  const requestedTab =
    typeof route.query.tab === "string" && (TAB_KEYS as readonly string[]).includes(route.query.tab)
      ? (route.query.tab as TabKey)
      : "songs";
  const tab: TabKey =
    searchSource.value === "local" && requestedTab === "playlists" ? "songs" : requestedTab;
  if (tab !== requestedTab) void router.replace({ query: { ...route.query, tab } });

  activeTab.value = tab;
  keyword.value = q;

  const keywordChanged = q !== lastLoadedKeyword;
  const sourceChanged = searchSource.value !== lastLoadedSource;
  const streamingServerChanged =
    searchSource.value === "streaming" && streaming.activeServerId !== lastLoadedStreamingServerId;

  if (keywordChanged || sourceChanged || streamingServerChanged) {
    lastLoadedKeyword = q;
    lastLoadedSource = searchSource.value;
    lastLoadedStreamingServerId = streaming.activeServerId;
    resetStates();
    if (q) fetchTab(tab, false);
  } else if (q && !states[tab].loaded) {
    fetchTab(tab, false);
  }
};

watch(
  () => [route.name, route.query.q, route.query.tab, searchSource.value, streaming.activeServerId],
  syncFromRoute,
  { immediate: true },
);

const onTabSwitch = (key: string): void => {
  router.replace({ query: { ...route.query, tab: key } });
};

const onPlatformSwitch = (key: string): void => {
  if (key === "local") {
    searchSource.value = "local";
    return;
  }
  if (key === "streaming") {
    searchSource.value = "streaming";
    return;
  }
  const platform = key as Platform;
  status.searchPlatform = platform;
  searchSource.value = platform;
};

/** 失败后重试加载当前 tab */
const onRetry = (): void => {
  error.value = "";
  fetchTab(activeTab.value, false);
};

/** 滚动触底加载下一页 */
const onReachBottom = (tab: TabKey): void => {
  fetchTab(tab, true);
};

/** 当前 tab 首屏加载中 */
const isInitialLoading = computed(() => {
  const state = states[activeTab.value];
  return state.loading && !state.loaded;
});

/** 当前 tab 已加载且为空 */
const isEmptyResult = computed(() => {
  const state = states[activeTab.value];
  return state.loaded && state.items.length === 0;
});

const isAuthError = computed(() => {
  if (searchSource.value === "local" || searchSource.value === "streaming") return false;
  if (!error.value) return false;
  const lower = error.value.toLowerCase();
  return (
    lower.includes("not logged in") ||
    lower.includes("未登录") ||
    lower.includes("authentication") ||
    lower.includes("unauthorized") ||
    lower.includes("auth error") ||
    lower.includes("401")
  );
});

const loginDialogOpen = ref(false);
const loginDialogTab = ref<"qobuz" | "tidal">("qobuz");

const openLoginModal = (): void => {
  if (status.searchPlatform === "tidal") {
    loginDialogTab.value = "tidal";
  } else {
    loginDialogTab.value = "qobuz";
  }
  loginDialogOpen.value = true;
};

const onLoginDialogClose = (open: boolean): void => {
  if (!open) {
    // 登录完成后重试加载
    onRetry();
  }
};
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 顶栏 -->
    <div class="shrink-0 px-5 pb-2">
      <div class="mt-2 mb-4 flex items-end justify-between gap-4">
        <h1 class="min-w-0 flex items-baseline pr-3">
          <span class="min-w-0 truncate text-3xl font-bold text-on-surface">
            {{ keyword || t("search.title") }}
          </span>
          <span
            v-if="keyword"
            class="ml-2 shrink-0 whitespace-nowrap font-medium text-lg text-on-surface-variant/60"
          >
            {{ t("search.titleSuffix") }}
          </span>
        </h1>
        <!-- 平台切换 -->
        <div class="shrink-0" :class="streaming.activeServer ? 'w-104 max-w-full' : 'w-64'">
          <STabs
            :model-value="searchSource"
            :tabs="platformTabs"
            type="segment"
            size="small"
            round
            @update:model-value="onPlatformSwitch"
          />
        </div>
      </div>
      <STabs :model-value="activeTab" :tabs="tabs" @update:model-value="onTabSwitch" />
    </div>
    <!-- 空关键词 -->
    <div v-if="!keyword" class="flex-1 flex items-center justify-center">
      <div class="text-center text-on-surface-variant/60">
        <IconLucideSearch class="size-14 mx-auto mb-4 opacity-30" />
        <div class="text-sm">{{ t("search.emptyKeyword") }}</div>
      </div>
    </div>
    <!-- 登录提示态 -->
    <div v-else-if="isAuthError" class="flex-1 flex items-center justify-center px-6">
      <div class="text-center flex flex-col items-center max-w-sm">
        <div
          class="size-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4"
        >
          <IconLucideLogIn class="size-8" />
        </div>
        <div class="text-base font-semibold text-on-surface mb-1">
          {{
            (status.searchPlatform === "tidal"
              ? "TIDAL"
              : status.searchPlatform === "qobuz"
                ? "Qobuz"
                : status.searchPlatform.toUpperCase()) + " 尚未登录"
          }}
        </div>
        <div class="text-xs text-on-surface-variant/80 mb-5 leading-relaxed">
          {{
            status.searchPlatform === "tidal"
              ? "搜索与播放 TIDAL 曲目需要先绑定授权您的 TIDAL 账号"
              : "搜索与播放该平台曲目需要先登录账号"
          }}
        </div>
        <div class="flex items-center gap-3">
          <SButton type="primary" size="medium" @click="openLoginModal">
            <template #icon><IconLucideLogIn class="size-4" /></template>
            登录
            {{
              status.searchPlatform === "tidal"
                ? "TIDAL"
                : status.searchPlatform === "qobuz"
                  ? "Qobuz"
                  : status.searchPlatform.toUpperCase()
            }}
          </SButton>
          <SButton variant="secondary" size="medium" @click="onRetry">
            <template #icon><IconLucideRotateCw class="size-4" /></template>
            {{ t("common.retry") }}
          </SButton>
        </div>
      </div>
    </div>
    <!-- 普通错误态 -->
    <div v-else-if="error" class="flex-1 flex items-center justify-center px-6">
      <div class="text-center flex flex-col items-center">
        <div class="text-red-500/85 mb-4">
          <IconLucideTriangleAlert class="size-14 mx-auto mb-3 opacity-50" />
          <div class="text-sm font-medium mb-1">{{ t("search.errorTitle") }}</div>
          <div class="text-xs opacity-80 break-all max-w-xs">{{ error }}</div>
        </div>
        <SButton
          variant="secondary"
          size="small"
          :loading="states[activeTab].loading"
          @click="onRetry"
        >
          <template #icon>
            <IconLucideRotateCw class="size-3.5" />
          </template>
          {{ t("common.retry") }}
        </SButton>
      </div>
    </div>
    <!-- 首次加载 -->
    <div v-else-if="isInitialLoading" class="flex-1 flex items-center justify-center">
      <div class="text-center text-on-surface-variant/60">
        <SLoading class="text-4xl text-primary/70 mb-4 mx-auto block" />
        <div class="text-sm">{{ t("common.loading") }}</div>
      </div>
    </div>
    <!-- 无结果 -->
    <div v-else-if="isEmptyResult" class="flex-1 flex items-center justify-center">
      <div class="text-center text-on-surface-variant/60">
        <IconLucideSearchX class="size-14 mx-auto mb-4 opacity-30" />
        <div class="text-sm mb-1">{{ t("search.noResults") }}</div>
        <div class="text-xs opacity-70">{{ t("search.noResultsHint") }}</div>
      </div>
    </div>
    <!-- 各 tab 内容 -->
    <div v-else class="flex-1 min-h-0">
      <SongList
        v-if="activeTab === 'songs'"
        :items="states.songs.items"
        :source="searchSource"
        :show-size="false"
        :has-more="states.songs.hasMore"
        :loading-more="states.songs.loadingMore"
        @reach-bottom="onReachBottom('songs')"
      />
      <CoverList
        v-else-if="activeTab === 'albums'"
        :items="states.albums.items"
        :padding-x="20"
        :padding-top="8"
        :padding-bottom="20"
        :has-more="states.albums.hasMore"
        :loading-more="states.albums.loadingMore"
        @click="(item) => navigateToAlbum(item.title, { source: searchSource, albumId: item.id })"
        @reach-bottom="onReachBottom('albums')"
      />
      <CoverList
        v-else-if="activeTab === 'artists'"
        :items="states.artists.items"
        type="artist"
        :min-size="120"
        :padding-x="20"
        :padding-top="8"
        :padding-bottom="20"
        :has-more="states.artists.hasMore"
        :loading-more="states.artists.loadingMore"
        @click="(item) => navigateToArtist(item.title, { source: searchSource, artistId: item.id })"
        @reach-bottom="onReachBottom('artists')"
      />
      <CoverList
        v-else
        :items="states.playlists.items"
        :padding-x="20"
        :padding-top="8"
        :padding-bottom="20"
        :has-more="states.playlists.hasMore"
        :loading-more="states.playlists.loadingMore"
        @click="(item) => navigateToPlaylist(item.id, { source: searchSource, name: item.title })"
        @reach-bottom="onReachBottom('playlists')"
      />
    </div>

    <!-- 流媒体平台登录弹窗 -->
    <StreamingLoginDialog
      v-model:open="loginDialogOpen"
      :tab="loginDialogTab"
      @update:open="onLoginDialogClose"
    />
  </div>
</template>
