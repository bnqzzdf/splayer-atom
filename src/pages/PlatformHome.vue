<script setup lang="ts">
/**
 * 在线平台首页（Qobuz / TIDAL / QQ音乐 / 酷狗音乐）
 *
 * 只展示**已登录**的平台，每个平台按标签切换，内容为该平台的
 * 分类导航 + 官方首页分区（榜单/新发行/推荐歌单等）。
 *
 * 四类平台的数据结构完全不同，这里统一归一化成 HomeSection：
 *   Qobuz: { containers: { <key>: { data: { items } } } }
 *   TIDAL: { rows: [{ modules: [{ type, items }] }] }
 *   QQ音乐: 榜单目录 [{ id, name, items: [{ id, name, cover, ... }] }]
 *   酷狗:   榜单目录 [{ id, name, items: [{ id, name, cover, ... }] }]
 * 页面只渲染 HomeSection，不关心平台差异。
 *
 * QM/KG 的卡片指向「榜单」，点击后进入 collection 页的 rank 类型详情
 * （services/collection/qqmusic|kugou 已支持 type === "rank"）。
 *
 * 书架分区（QM 热门歌单 / KG 精选歌单 + 新歌首发）排在榜单之前；
 * 这些接口为什么走该通道，在 core 侧对应模块的注释里有说明。
 */
defineOptions({ name: "PlatformHome" });

import { useProviderSessionsStore } from "@/stores/providerSessions";
import type { Track } from "@shared/types/player";
import StreamingLoginDialog from "@/components/modals/StreamingLoginDialog.vue";
import * as qobuzApi from "@/apis/qobuz";
import * as tidalApi from "@/apis/tidal";
import {
  fetchQQMusicHotPlaylists,
  fetchQQMusicNewAlbums,
  fetchQQMusicNewSongs,
  fetchQQMusicToplist,
  type QMHotPlaylist,
  type QMNewAlbum,
  type QMToplistGroup,
} from "@/apis/playlist/qqmusic";
import {
  fetchKugouHotArtists,
  fetchKugouHotPlaylists,
  fetchKugouNewSongs,
  fetchKugouRankList,
  type KGHotArtist,
  type KGHotPlaylist,
  type KGRankGroup,
} from "@/apis/playlist/kugou";
import { formatCompact } from "@/utils/format";
import {
  ALL_PLATFORMS,
  PLATFORM_LABELS,
  SHELF_TABS,
  asArray,
  asRecord,
  openPlatformHomeItem,
  qobuzSectionEndpoint,
  qobuzSectionTitle,
  kgHotArtistToItem,
  qmNewAlbumToItem,
  shelfDefaultTab,
  str,
  tidalModulePath,
  toQobuzItem,
  toTidalItem,
  trackToAlbumItem,
  type HomeItem,
  type HomeSection,
  type Platform,
} from "@/services/platformHome";
import IconLucideRefreshCw from "~icons/lucide/refresh-cw";
import IconLucideMusic from "~icons/lucide/music";
import IconLucideDisc3 from "~icons/lucide/disc-3";
import IconLucideChevronRight from "~icons/lucide/chevron-right";

const { t, locale } = useI18n();
const providerSessions = useProviderSessionsStore();
const router = useRouter();

/** 分类（流派）导航项 */
interface GenreItem {
  id: string;
  name: string;
}

const platform = ref<Platform>("qobuz");
const loading = ref(false);
const error = ref<string>("");
const sections = ref<HomeSection[]>([]);
const genres = ref<GenreItem[]>([]);
/**
 * 当前筛选的流派 / 榜单分组；空串表示不筛选。
 *
 * 这排标签在两个平台语义不同，所以渲染位置也不同：
 * - Qobuz/TIDAL：**整页**的流派筛选（换 genre_id 重新拉首页），放在平台标签下方；
 * - QM/KG：只是**榜单区**的分组筛选，所以挪进「榜单」区里——留在页面顶部时，
 *   它离被控制的内容隔着几排书架，点了会像没反应。
 */
const activeGenre = ref<string>("");
/**
 * 各书架当前选中的地区/语种（键 = 分区 key，也就是书架标识）。
 *
 * 与顶部的 `activeGenre` 是两回事：那是整页的榜单分组/流派筛选，
 * 这是每个书架自己的地区标签（官方每个书架右上/下方都有一排）。
 */
const activeTabs = ref<Record<string, string>>({});
/** 登录对话框（认证失效时提供「去登录」入口，而不是只丢一个裸错误串） */
const loginDialogOpen = ref(false);

/**
 * 判断错误是不是「需要登录」这一类。
 *
 * 各平台措辞不同，实测遇到的几种：
 *   - `API error (401): TIDAL token 已过期且自动刷新失败，请重新登录 …`
 *   - `Authentication error: Qobuz is not logged in`
 *   - `API error (401): User authentication is required.`
 * 这类失败给用户「去登录」的明确动作，比展示原始报文有用得多。
 */
const isAuthError = (message: string): boolean =>
  /(?:\b401\b|not logged in|authentication is required|token .*expired|已过期|重新登录)/i.test(
    message,
  );

/** 当前错误是否属于「需要登录」 */
const errorNeedsLogin = computed(() => error.value !== "" && isAuthError(error.value));

/** 已登录的平台才显示标签 */
const loggedInPlatforms = computed<Platform[]>(() =>
  ALL_PLATFORMS.filter((p) => providerSessions.sessions[p]?.authenticated),
);

const platformTabs = computed(() =>
  loggedInPlatforms.value.map((p) => ({ key: p, label: PLATFORM_LABELS[p] })),
);

/** 当前平台是否已登录 */
const currentAuthed = computed(() =>
  Boolean(providerSessions.sessions[platform.value]?.authenticated),
);

/** QM/KG 的这排标签是榜单分组而非流派——决定它渲染在页面顶部还是「榜单」区里 */
const isRankGroupPlatform = computed(
  () => platform.value === "qqmusic" || platform.value === "kugou",
);

/** 页面顶部的流派筛选行：只有 Qobuz/TIDAL 有（它们的 genre 作用于整页） */
const showGenreRow = computed(() => genres.value.length > 0 && !isRankGroupPlatform.value);

/** 榜单分组标签；首个「全部」表示不筛选，也就是默认状态 */
const rankGroupTabs = computed<GenreItem[]>(() =>
  isRankGroupPlatform.value ? [{ id: "", name: t("platformHome.allRanks") }, ...genres.value] : [],
);

/** 第 index 个分区是否是某个大类（目前只有「榜单」）的第一节：分组标题与标签只渲染一次 */
const isGroupStart = (index: number): boolean => {
  const current = sections.value[index];
  return Boolean(current?.group) && current.group !== sections.value[index - 1]?.group;
};

// ---------- 归一化 ----------

const normalizeQobuz = (data: unknown): HomeSection[] => {
  const containers = asRecord(asRecord(data).containers);
  return Object.entries(containers)
    .map(([key, value]) => {
      const container = asRecord(value);
      const itemsData = asRecord(container.data);
      const items = asArray(itemsData.items)
        .map(toQobuzItem)
        .filter((x): x is HomeItem => x !== null);
      // 全部条目都是标签时，整个分区按标签行渲染
      const variant: HomeSection["variant"] =
        items.length > 0 && items.every((item) => item.kind === "tag") ? "tags" : "cards";
      // 只有平台说还有更多、且该容器有对应的翻页端点时才给「查看全部」：
      // 端点是原生白名单里的名字，表里查不到就没法翻页，给了入口也只会在下一页报错。
      const endpoint = qobuzSectionEndpoint(key);
      const more =
        itemsData.has_more === true && endpoint
          ? {
              platform: "qobuz" as const,
              section: key,
              ...(activeGenre.value ? { genre: activeGenre.value } : {}),
            }
          : undefined;
      return { key, title: qobuzSectionTitle(key), variant, items, ...(more ? { more } : {}) };
    })
    .filter((section) => section.items.length > 0);
};

const tidalModuleTitle = (type: string): string => {
  const map: Record<string, string> = {
    ALBUM_LIST: "专辑推荐",
    PLAYLIST_LIST: "歌单推荐",
    TRACK_LIST: "曲目推荐",
    ARTIST_LIST: "艺人推荐",
    VIDEO_LIST: "视频推荐",
    MIX_LIST: "混音推荐",
  };
  return map[type] ?? "推荐";
};

/**
 * TIDAL 分区标题的中文化。
 *
 * 这些标题来自 TIDAL 的 `pages/home`（不是我们的 UI 文案）。实测 TIDAL 本身**会**按
 * `locale` 本地化分区标题：de_DE → `Die Hits`、fr_FR → `Les hits`、pt_BR → `Os Sucessos`；
 * 但**没有中文 locale**：zh_CN / zh_TW / zh_HK / zh_SG / zh-Hans / zh-Hant 全部回落到英文。
 * 所以中文只能由我们自己做映射。
 *
 * 两点刻意的取舍：
 * - 只映射**完全匹配**的已知标题。TIDAL 新增分区时原样透出英文，而不是被错误翻译；
 * - 不映射歌单名（`TIDAL's Top Hits`、`Pop Hits` 这类）：实测它们连在德语下都不本地化，
 *   属于 TIDAL 的编辑歌单正式名称，翻译反而会与官方名称不符，且数量多、会变动。
 *
 * 与 Qobuz 侧既有的 `qobuzSectionTitle()`（new_releases → 新发行）保持同一做法。
 */
const tidalSectionTitle = (rawTitle: string | undefined, type: string): string => {
  const known: Record<string, string> = {
    "The Hits": t("platformHome.tidalSection.hits"),
    "New Tracks": t("platformHome.tidalSection.newTracks"),
    "New Albums": t("platformHome.tidalSection.newAlbums"),
    "Spotlighted Uploads": t("platformHome.tidalSection.spotlightedUploads"),
    "From our editors": t("platformHome.tidalSection.fromOurEditors"),
  };
  if (rawTitle && known[rawTitle]) return known[rawTitle];
  return rawTitle ?? tidalModuleTitle(type);
};

const normalizeTidal = (data: unknown): HomeSection[] => {
  const rows = asArray(asRecord(data).rows);
  const out: HomeSection[] = [];
  rows.forEach((row, rowIndex) => {
    const rowRecord = asRecord(row);
    asArray(rowRecord.modules).forEach((module, moduleIndex) => {
      const moduleRecord = asRecord(module);
      const type = str(moduleRecord.type) ?? "";
      const paged = asRecord(moduleRecord.pagedList);
      const rawItems = asArray(paged.items).length
        ? asArray(paged.items)
        : asArray(moduleRecord.items);
      const items = rawItems
        .map((entry) => toTidalItem(entry, type))
        .filter((x): x is HomeItem => x !== null);
      if (!items.length) return;
      // 官方「View all」走模块自带的 dataApiPath 翻页；分页信息缺失就不给入口
      const path = tidalModulePath(paged);
      const total =
        typeof paged.totalNumberOfItems === "number" ? paged.totalNumberOfItems : undefined;
      const hasMore = Boolean(path) && (total === undefined || total > items.length);
      const more =
        hasMore && path
          ? { platform: "tidal" as const, section: path, path, moduleType: type }
          : undefined;
      out.push({
        key: `row-${rowIndex}-${moduleIndex}`,
        title: tidalSectionTitle(str(moduleRecord.title) ?? str(rowRecord.title), type),
        variant: "cards",
        items,
        ...(more ? { more } : {}),
      });
    });
  });
  return out;
};

/**
 * QQ音乐榜单目录 → HomeSection。
 *
 * topList 接口已经返回每个榜单的头图（T003R500x500），所以卡片直接用榜单封面；
 * 点进去才是该榜单的歌曲列表（collection/rank）。
 */
const normalizeQQMusic = (groups: QMToplistGroup[]): HomeSection[] =>
  groups.map((group) => ({
    key: `qm-${group.id}`,
    title: group.name,
    // 榜单区整片挂同一个分组标题，用户才知道顶部那排按钮在控制什么
    group: t("platformHome.ranks"),
    variant: "cards",
    items: group.items.map((item) => ({
      id: item.id,
      title: item.name,
      subtitle:
        [item.total ? `${item.total} 首` : "", item.updateTime].filter(Boolean).join(" · ") ||
        undefined,
      image: item.cover || undefined,
      kind: "rank",
    })),
  }));

/** 酷狗榜单目录 → HomeSection（结构与 QM 一致，仅副标题信息不同） */
const normalizeKugou = (groups: KGRankGroup[]): HomeSection[] =>
  groups.map((group) => ({
    key: `kg-${group.id}`,
    title: group.name,
    group: t("platformHome.ranks"),
    variant: "cards",
    items: group.items.map((item) => ({
      id: item.id,
      title: item.name,
      subtitle: item.updateFrequency || undefined,
      image: item.cover || undefined,
      kind: "rank",
    })),
  }));

/** 榜单目录分组 → 分类导航项 */
const groupsToGenres = (groups: Array<{ id: string; name: string }>): GenreItem[] =>
  groups
    .filter((group) => group.id && group.name)
    .map((group) => ({ id: group.id, name: group.name }));

/** 首页书架默认展示的卡片数（接口一次给 30/99 条，页面只铺 2 行） */
const SHELF_LIMIT = 12;

/** QM 热门歌单 → HomeSection（id 是歌单 dissid，点击进歌单详情） */
const qmHotPlaylistSection = (playlists: QMHotPlaylist[]): HomeSection => ({
  key: "qm-hot-playlists",
  title: t("platformHome.hotPlaylists"),
  variant: "cards",
  items: playlists.slice(0, SHELF_LIMIT).map((item) => ({
    id: item.id,
    title: item.name,
    subtitle:
      item.creator || (item.playCount ? formatCompact(item.playCount, locale.value) : undefined),
    image: item.cover || undefined,
    kind: "playlist",
  })),
});

/** KG 精选歌单 → HomeSection（id 是 specialid，点击进歌单详情） */
const kgHotPlaylistSection = (playlists: KGHotPlaylist[]): HomeSection => ({
  key: "kg-hot-playlists",
  title: t("platformHome.hotPlaylists"),
  variant: "cards",
  items: playlists.slice(0, SHELF_LIMIT).map((item) => ({
    id: item.id,
    title: item.name,
    subtitle:
      item.trackCount > 0
        ? `${item.trackCount} 首`
        : item.playCount
          ? formatCompact(item.playCount, locale.value)
          : undefined,
    image: item.cover || undefined,
    kind: "playlist",
  })),
});

/**
 * 给 QM/KG 的书架挂上地区标签与「更多」入口。
 *
 * 只有 SHELF_TABS 里登记过的书架才有标签；标签与取值都来自实测（见该常量的注释）。
 * 「更多」把分区页当作「同一书架 + 同一地区」的完整列表。
 */
const withShelf = (section: HomeSection): HomeSection => {
  const tabs = SHELF_TABS[section.key];
  if (!tabs) return section;
  const activeTab = shelfTab(section.key);
  return {
    ...section,
    tabs,
    activeTab,
    more: { platform: platform.value, section: section.key, tab: activeTab },
  };
};

/**
 * 「新歌首发」→ HomeSection（QM 与 KG 共用）。
 *
 * 新歌是「歌曲」，但平台首页只有专辑/歌单/歌手三种详情页，没有单曲详情页，
 * 因此与 TIDAL 的 TRACK_LIST 保持同一处理：卡片点击进入该歌曲所属专辑。
 * 歌曲自身仍带着完整的取流字段（KG 是 hash / albumAudioId，QM 是 mid / mediaMid），
 * 进入专辑后即可正常播放。
 */
const newSongSection = (key: string, title: string, tracks: Track[]): HomeSection =>
  withShelf({
    key,
    title,
    variant: "cards",
    items: tracks.slice(0, SHELF_LIMIT).map(trackToAlbumItem),
  });

/** QM 新碟首发 → HomeSection */
const qmNewAlbumSection = (albums: QMNewAlbum[]): HomeSection =>
  withShelf({
    key: "qm-new-albums",
    title: t("platformHome.newAlbums"),
    variant: "cards",
    items: albums.slice(0, SHELF_LIMIT).map(qmNewAlbumToItem),
  });

/** KG 热门歌手 → HomeSection（歌手卡片，点击进歌手详情） */
const kgHotArtistSection = (artists: KGHotArtist[]): HomeSection =>
  withShelf({
    key: "kg-hot-artists",
    title: t("platformHome.hotArtists"),
    variant: "cards",
    items: artists.slice(0, SHELF_LIMIT).map((artist) => ({
      ...kgHotArtistToItem(artist),
      subtitle: artist.fansCount
        ? t("platformHome.fansCount", { count: formatCompact(artist.fansCount, locale.value) })
        : undefined,
    })),
  });

const normalizeGenres = (p: Platform, data: unknown): GenreItem[] => {
  if (p === "qobuz") {
    const items = asArray(asRecord(asRecord(data).genres).items);
    return items
      .map((g) => {
        const record = asRecord(g);
        const id = str(record.id);
        const name = str(record.name);
        return id && name ? { id, name } : null;
      })
      .filter((x): x is GenreItem => x !== null);
  }
  return asArray(data)
    .map((g) => {
      const record = asRecord(g);
      const id = str(record.id);
      const name = str(record.name);
      return id && name ? { id, name } : null;
    })
    .filter((x): x is GenreItem => x !== null);
};

// ---------- 点击跳转 ----------

const openItem = (item: HomeItem): void => openPlatformHomeItem(item, platform.value);

/**
 * 打开某个分区的「查看全部」。
 *
 * 只把定位信息放进 query，让分区页可以独立刷新/分享：
 * Qobuz 用容器键 + 流派（端点名由分区页查表得出），TIDAL 用模块的 dataApiPath。
 */
const openSection = (section: HomeSection): void => {
  const more = section.more;
  if (!more) return;
  void router.push({
    name: "platform-section",
    params: { platform: more.platform, section: more.section },
    query: {
      title: section.title,
      ...(more.genre ? { genre: more.genre } : {}),
      ...(more.path ? { path: more.path } : {}),
      ...(more.moduleType ? { type: more.moduleType } : {}),
    },
  });
};

// ---------- 加载 ----------

const load = async (): Promise<void> => {
  if (!currentAuthed.value) {
    sections.value = [];
    genres.value = [];
    error.value = "";
    return;
  }
  loading.value = true;
  error.value = "";
  // 先清空上一个平台的内容与分类，避免加载失败时残留另一平台的分类栏
  sections.value = [];
  genres.value = [];
  try {
    const genreParam = activeGenre.value || undefined;
    if (platform.value === "qobuz") {
      const [home, genreData] = await Promise.all([
        qobuzApi.discoverIndex(genreParam ? { genre_id: genreParam } : undefined),
        qobuzApi.genreList().catch(() => null),
      ]);
      sections.value = normalizeQobuz(home);
      genres.value = genreData ? normalizeGenres("qobuz", genreData) : [];
    } else if (platform.value === "tidal") {
      const [home, genreData] = await Promise.all([
        tidalApi.pagesHome(),
        tidalApi.genres().catch(() => []),
      ]);
      sections.value = normalizeTidal(home);
      genres.value = normalizeGenres("tidal", genreData);
    } else if (platform.value === "qqmusic") {
      // QM 的分类导航就是榜单分组，点击分组只过滤已拉取的目录，不再请求接口
      const [groups, hotPlaylists, newSongs, newAlbums] = await Promise.all([
        fetchQQMusicToplist(),
        // 下面三个书架任一个拉不到都不该影响榜单展示
        fetchQQMusicHotPlaylists(30).catch(() => [] as QMHotPlaylist[]),
        fetchQQMusicNewSongs(30, Number(shelfTab("qm-new-songs"))).catch(() => [] as Track[]),
        fetchQQMusicNewAlbums(30, Number(shelfTab("qm-new-albums"))).catch(
          () => [] as QMNewAlbum[],
        ),
      ]);
      const visible = genreParam ? groups.filter((group) => group.id === genreParam) : groups;
      sections.value = [
        ...(newSongs.length
          ? [newSongSection("qm-new-songs", t("platformHome.newSongs"), newSongs)]
          : []),
        ...(newAlbums.length ? [qmNewAlbumSection(newAlbums)] : []),
        ...(hotPlaylists.length ? [qmHotPlaylistSection(hotPlaylists)] : []),
        ...normalizeQQMusic(visible),
      ];
      genres.value = groupsToGenres(groups);
    } else {
      const [groups, hotPlaylists, newSongs, hotArtists] = await Promise.all([
        fetchKugouRankList(),
        fetchKugouHotPlaylists(1, 30).catch(() => [] as KGHotPlaylist[]),
        fetchKugouNewSongs(30, Number(shelfTab("kg-new-songs"))).catch(() => [] as Track[]),
        fetchKugouHotArtists(30, Number(shelfTab("kg-hot-artists"))).catch(
          () => [] as KGHotArtist[],
        ),
      ]);
      const visible = genreParam ? groups.filter((group) => group.id === genreParam) : groups;
      sections.value = [
        ...(newSongs.length
          ? [newSongSection("kg-new-songs", t("platformHome.newSongs"), newSongs)]
          : []),
        ...(hotArtists.length ? [kgHotArtistSection(hotArtists)] : []),
        ...(hotPlaylists.length ? [kgHotPlaylistSection(hotPlaylists)] : []),
        ...normalizeKugou(visible),
      ];
      genres.value = groupsToGenres(groups);
    }
    if (!sections.value.length) error.value = t("platformHome.empty");
  } catch (err) {
    sections.value = [];
    genres.value = [];
    error.value = err instanceof Error ? err.message : t("platformHome.loadFailed");
  } finally {
    loading.value = false;
  }
};

/** 切换平台时清掉流派筛选 */
const switchPlatform = async (next: Platform): Promise<void> => {
  platform.value = next;
  activeGenre.value = "";
  await load();
};

/** 登录对话框关闭：若该平台已登录，自动重载首页（省掉用户手动刷新） */
const onLoginDialogClose = async (open: boolean): Promise<void> => {
  if (open) return;
  await providerSessions.refresh().catch(() => {});
  if (providerSessions.sessions[platform.value]?.authenticated) await load();
};

const selectGenre = async (id: string): Promise<void> => {
  activeGenre.value = activeGenre.value === id ? "" : id;
  await load();
};

/** 某书架当前生效的地区值（没选过就用 SHELF_TABS 的第一项） */
const shelfTab = (key: string): string => activeTabs.value[key] ?? shelfDefaultTab(key) ?? "";

/**
 * 切换某书架的地区标签。
 *
 * 这里选择整页重载而不是局部刷新：与 `selectGenre` 一致，且各平台的取数是并发的，
 * 局部刷新要额外维护「哪些书架在加载」的状态，收益不抵复杂度。
 */
const selectShelfTab = async (section: HomeSection, value: string): Promise<void> => {
  activeTabs.value = { ...activeTabs.value, [section.key]: value };
  await load();
};

watch(
  () => loggedInPlatforms.value.join(","),
  (joined) => {
    const list = joined ? (joined.split(",") as Platform[]) : [];
    if (list.length && !list.includes(platform.value)) platform.value = list[0];
  },
  { immediate: true },
);

onMounted(async () => {
  await providerSessions.refresh().catch(() => {});
  await load();
});
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto flex max-w-[1400px] flex-col gap-5 px-4 pb-10 pt-4 sm:px-6 sm:pt-6">
      <!-- 未登录任何平台 -->
      <div v-if="!loggedInPlatforms.length" class="py-16 text-center">
        <IconLucideMusic class="mx-auto size-10 text-on-surface-variant/40" />
        <p class="mt-3 text-sm text-on-surface-variant">{{ t("platformHome.noPlatform") }}</p>
      </div>

      <template v-else>
        <!-- 平台标签 -->
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <button
              v-for="tab in platformTabs"
              :key="tab.key"
              type="button"
              class="rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
              :class="
                platform === tab.key
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-variant/15 text-on-surface-variant hover:bg-surface-variant/25'
              "
              @click="switchPlatform(tab.key)"
            >
              {{ tab.label }}
            </button>
          </div>
          <SButton variant="secondary" size="small" :loading="loading" @click="load">
            <IconLucideRefreshCw class="size-3.5" />
          </SButton>
        </div>

        <!--
          流派筛选：只有 Qobuz/TIDAL 放在这里。
          QM/KG 的那排标签是榜单分组，只作用于榜单区，已挪到「榜单」标题下面——
          留在页面顶部时它离被控制的内容隔着几排书架，点了会像没反应。
        -->
        <div v-if="showGenreRow" class="flex flex-wrap gap-1.5">
          <button
            v-for="genre in genres"
            :key="genre.id"
            type="button"
            class="rounded-md px-2.5 py-1 text-xs transition-colors"
            :class="
              activeGenre === genre.id
                ? 'bg-primary/15 text-primary'
                : 'text-on-surface-variant hover:bg-surface-variant/15'
            "
            @click="selectGenre(genre.id)"
          >
            {{ genre.name }}
          </button>
        </div>

        <!-- 加载中 -->
        <div
          v-if="loading && !sections.length"
          class="py-16 text-center text-sm text-on-surface-variant"
        >
          {{ t("common.loading") }}
        </div>

        <!-- 错误 -->
        <!-- 认证类失败给「去登录」入口；其余（网络、上游故障）才展示原始报文 -->
        <div v-else-if="error" class="py-16 text-center text-sm text-on-surface-variant">
          <template v-if="errorNeedsLogin">
            <p>{{ t("platformHome.authRequired", { platform: PLATFORM_LABELS[platform] }) }}</p>
            <SButton class="mt-3" variant="filled" size="small" @click="loginDialogOpen = true">
              {{ t("platformHome.signIn") }}
            </SButton>
            <p class="mt-3 text-xs text-on-surface-variant/60">{{ error }}</p>
          </template>
          <template v-else>{{ error }}</template>
        </div>

        <!-- 分区列表 -->
        <template v-for="(section, index) in sections" :key="section.key">
          <!--
            大类标题（目前只有「榜单」）在分组切换处渲染一次。
            榜单分组的筛选标签就挂在这里：它只作用于榜单区，跟着被控制的内容走，
            用户才不会以为按钮没反应。
          -->
          <div v-if="isGroupStart(index)" class="mt-1 flex flex-col gap-2">
            <h3 class="text-lg font-semibold text-on-surface">{{ section.group }}</h3>
            <div v-if="rankGroupTabs.length" class="flex flex-wrap gap-1.5">
              <button
                v-for="tab in rankGroupTabs"
                :key="tab.id"
                type="button"
                class="rounded-md px-2.5 py-1 text-xs transition-colors"
                :class="
                  activeGenre === tab.id
                    ? 'bg-primary/15 text-primary'
                    : 'text-on-surface-variant hover:bg-surface-variant/15'
                "
                @click="selectGenre(tab.id)"
              >
                {{ tab.name }}
              </button>
            </div>
          </div>
          <section class="flex flex-col gap-2.5">
            <!-- 标题行：官方在每个分区右上角都有「查看全部」，这里只在该分区确实还能翻页时给 -->
            <div class="flex items-center justify-between gap-3">
              <h2 class="text-base font-semibold text-on-surface">{{ section.title }}</h2>
              <button
                v-if="section.more"
                type="button"
                class="flex shrink-0 items-center gap-0.5 text-xs text-on-surface-variant transition-colors hover:text-primary"
                @click="openSection(section)"
              >
                {{ t("platformHome.viewAll") }}
                <IconLucideChevronRight class="size-3.5" />
              </button>
            </div>

            <!-- 地区/语种标签：官方每个书架下面都有一排，切换后只重载这一份列表 -->
            <div v-if="section.tabs?.length" class="flex flex-wrap gap-1.5">
              <button
                v-for="tab in section.tabs"
                :key="tab.value"
                type="button"
                class="rounded-md px-2.5 py-1 text-xs transition-colors"
                :class="
                  section.activeTab === tab.value
                    ? 'bg-primary/15 text-primary'
                    : 'text-on-surface-variant hover:bg-surface-variant/15'
                "
                @click="selectShelfTab(section, tab.value)"
              >
                {{ t(tab.labelKey) }}
              </button>
            </div>

            <!-- 标签行：导航标签没有封面也没有详情页，只做展示 -->
            <div v-if="section.variant === 'tags'" class="flex flex-wrap gap-1.5">
              <span
                v-for="item in section.items"
                :key="`${section.key}-${item.id}`"
                class="rounded-md bg-surface-variant/15 px-2.5 py-1 text-xs text-on-surface-variant"
              >
                {{ item.title }}
              </span>
            </div>

            <!-- 封面卡片 -->
            <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              <button
                v-for="item in section.items"
                :key="`${section.key}-${item.id}`"
                type="button"
                class="group min-w-0 text-left"
                :title="item.title"
                @click="openItem(item)"
              >
                <div
                  class="relative aspect-square w-full overflow-hidden rounded-lg bg-surface-variant/10 transition-transform duration-200 group-hover:scale-[1.03]"
                >
                  <SImg v-if="item.image" :src="item.image" :alt="item.title" class="size-full" />
                  <div v-else class="flex size-full items-center justify-center">
                    <IconLucideDisc3 class="size-7 text-on-surface-variant/30" />
                  </div>
                  <!-- 音质角标：与列表页的音质标签同一套配色，压在深色蒙层上保证可读 -->
                  <span
                    v-if="item.badge"
                    class="absolute top-1.5 left-1.5 rounded border border-solid border-amber-500/40 bg-black/45 px-1 text-[10px] leading-[16px] font-bold text-amber-500 backdrop-blur-sm"
                  >
                    {{ item.badge }}
                  </span>
                </div>
                <p
                  class="mt-1.5 truncate text-xs font-medium text-on-surface group-hover:text-primary"
                >
                  {{ item.title }}
                </p>
                <p
                  v-if="item.subtitle"
                  class="truncate text-[11px] text-on-surface-variant/60"
                  :title="item.subtitle"
                >
                  {{ item.subtitle }}
                </p>
              </button>
            </div>
          </section>
        </template>
      </template>
    </div>

    <!-- 认证失效时的登录入口：登录成功后自动重载当前平台首页 -->
    <StreamingLoginDialog
      v-if="platform === 'qobuz' || platform === 'tidal'"
      v-model:open="loginDialogOpen"
      :tab="platform === 'tidal' ? 'tidal' : 'qobuz'"
      :single-platform="platform === 'tidal' ? 'tidal' : 'qobuz'"
      @update:open="onLoginDialogClose"
    />
  </div>
</template>
