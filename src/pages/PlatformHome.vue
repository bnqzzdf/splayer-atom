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
  fetchQQMusicToplist,
  type QMHotPlaylist,
  type QMToplistGroup,
} from "@/apis/playlist/qqmusic";
import {
  fetchKugouHotPlaylists,
  fetchKugouNewSongs,
  fetchKugouRankList,
  type KGHotPlaylist,
  type KGRankGroup,
} from "@/apis/playlist/kugou";
import { resolveQobuzCover } from "@/utils/format/qobuz";
import { resolveTidalCover } from "@/utils/format/tidal";
import { formatCompact } from "@/utils/format";
import {
  navigateToAlbum,
  navigateToArtist,
  navigateToPlaylist,
  navigateToRank,
} from "@/utils/navigate";
import IconLucideRefreshCw from "~icons/lucide/refresh-cw";
import IconLucideMusic from "~icons/lucide/music";
import IconLucideDisc3 from "~icons/lucide/disc-3";

const { t, locale } = useI18n();
const providerSessions = useProviderSessionsStore();

type Platform = "qobuz" | "tidal" | "qqmusic" | "kugou";

/** 支持的平台顺序（也是标签顺序） */
const ALL_PLATFORMS: Platform[] = ["qobuz", "tidal", "qqmusic", "kugou"];

const PLATFORM_LABELS: Record<Platform, string> = {
  qobuz: "Qobuz",
  tidal: "TIDAL",
  qqmusic: "QQ音乐",
  kugou: "酷狗音乐",
};

/** 归一化后的首页条目 */
interface HomeItem {
  id: string;
  title: string;
  subtitle?: string;
  image?: string;
  /**
   * 决定点击后跳哪种详情页。
   *
   * `tag` 表示这是导航标签（如 Qobuz 的 playlists_tags：只有 id/name/slug，
   * 既没有封面也没有可打开的详情页），只做展示、不响应点击——
   * 早期把它当歌单处理，导致封面空白且点击请求 playlist_get 报 404。
   *
   * `rank` 表示平台官方榜单（QQ音乐 topid / 酷狗 rankid），
   * 点击进入 collection 页的 rank 类型：展示该榜单的歌曲列表。
   */
  kind: "album" | "playlist" | "track" | "artist" | "tag" | "rank";
}

/** 归一化后的分区 */
interface HomeSection {
  key: string;
  title: string;
  /** cards：封面卡片；tags：纯标签行 */
  variant: "cards" | "tags";
  items: HomeItem[];
}

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
/** 当前筛选的流派；空串表示不筛选 */
const activeGenre = ref<string>("");
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

// ---------- 归一化 ----------

const qobuzSectionTitle = (key: string): string => {
  const map: Record<string, string> = {
    album_of_the_week: "本周专辑",
    new_releases: "新发行",
    recent_releases: "近期发行",
    most_streamed: "最常播放",
    playlists: "推荐歌单",
    playlists_tags: "歌单标签",
    ideal_discography: "理想唱片",
    press_awards: "媒体推荐",
    qobuzissims: "Qobuzissims",
    banners: "焦点",
  };
  return map[key] ?? key;
};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const str = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
};

/** Qobuz 条目 → HomeItem（专辑与歌单字段不同，按有无 track_count 区分） */
const toQobuzItem = (raw: unknown): HomeItem | null => {
  const item = asRecord(raw);
  const id = str(item.id);
  const title = str(item.title) ?? str(item.name);
  if (!id || !title) return null;
  const artists = asArray(item.artists)
    .map((a) => str(asRecord(a).name))
    .filter(Boolean)
    .join(", ");
  const image = resolveQobuzCover(item, 300);
  // 判定「导航标签」：既没有封面、也不是可打开的资源（无 track_count / tracks_count），
  // 只带 id+name+slug。Qobuz 的 playlists_tags 就是这种。
  const isTag =
    !image && item.track_count == null && item.tracks_count == null && item.slug != null;
  return {
    id,
    title,
    subtitle: artists || str(item.description)?.slice(0, 48),
    // 复用 format/qobuz 的封面解析：它已覆盖专辑 {large,small} 与歌单 {covers:[...]}
    // 两种结构，并统一走 /api/proxy/image。
    image,
    kind: isTag ? "tag" : item.track_count != null ? "album" : "playlist",
  };
};

const normalizeQobuz = (data: unknown): HomeSection[] => {
  const containers = asRecord(asRecord(data).containers);
  return Object.entries(containers)
    .map(([key, value]) => {
      const items = asArray(asRecord(asRecord(value).data).items)
        .map(toQobuzItem)
        .filter((x): x is HomeItem => x !== null);
      // 全部条目都是标签时，整个分区按标签行渲染
      const variant: HomeSection["variant"] =
        items.length > 0 && items.every((item) => item.kind === "tag") ? "tags" : "cards";
      return { key, title: qobuzSectionTitle(key), variant, items };
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

/**
 * TIDAL 条目 → HomeItem。
 *
 * 封面字段按类型分布：歌单在 squareImage（其 image 是矩形编辑图，取 640 会 403）、
 * 专辑在 cover、曲目在 album.cover。这里交给 format/tidal 的 resolveTidalCover，
 * 它已实现该优先级并统一走 /api/proxy/image。
 */
const toTidalItem = (raw: unknown, moduleType: string): HomeItem | null => {
  const item = asRecord(raw);
  // 歌单用 uuid（不是 id）：TIDAL 的 PLAYLIST_LIST 项没有 id 字段，
  // 早期只读 item.id 会把整个歌单分区静默丢弃。
  const id = str(item.id) ?? str(item.uuid);
  const title = str(item.title) ?? str(item.name);
  if (!id || !title) return null;
  const artists =
    asArray(item.artists)
      .map((a) => str(asRecord(a).name))
      .filter(Boolean)
      .join(", ") ||
    asArray(item.creators)
      .map((c) => str(asRecord(c).name))
      .filter(Boolean)
      .join(", ");
  const albumCover = str(asRecord(item.album).cover);
  const kind: HomeItem["kind"] =
    moduleType === "ALBUM_LIST"
      ? "album"
      : moduleType === "TRACK_LIST" || moduleType === "VIDEO_LIST"
        ? "track"
        : moduleType === "ARTIST_LIST"
          ? "artist"
          : "playlist";
  // 曲目分区点击进专辑详情，其余按自身类型
  const targetId = kind === "track" ? (str(asRecord(item.album).id) ?? id) : id;
  const targetKind: HomeItem["kind"] = kind === "track" ? "album" : kind;
  return {
    id: targetId,
    title,
    subtitle: artists || undefined,
    image: resolveTidalCover({
      squareImage: item.squareImage as never,
      image: item.image as never,
      cover: (item.cover ?? albumCover) as never,
    }),
    kind: targetKind,
  };
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
      out.push({
        key: `row-${rowIndex}-${moduleIndex}`,
        title: tidalSectionTitle(str(moduleRecord.title) ?? str(rowRecord.title), type),
        variant: "cards",
        items,
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
 * KG 新歌首发 → HomeSection。
 *
 * 新歌是「歌曲」，但平台首页只有专辑/歌单/歌手三种详情页，没有单曲详情页，
 * 因此与 TIDAL 的 TRACK_LIST 保持同一处理：卡片点击进入该歌曲所属专辑。
 * 歌曲自身仍带着完整的 hash / albumAudioId，进入专辑后即可正常播放。
 */
const kgNewSongSection = (tracks: Track[]): HomeSection => ({
  key: "kg-new-songs",
  title: t("platformHome.newSongs"),
  variant: "cards",
  items: tracks.slice(0, SHELF_LIMIT).map((track) => {
    const albumId = track.album?.id;
    return {
      id: albumId ?? track.id,
      title: track.title,
      subtitle: track.artists?.map((artist) => artist.name).join(", ") || undefined,
      image: track.cover,
      kind: "album" as const,
    };
  }),
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

/**
 * 打开条目对应的详情页。
 *
 * 详情页本身已支持 qobuz/tidal（services/collection 里有对应 loader），
 * 所以这里只需把 source/id 传过去。
 */
const openItem = (item: HomeItem): void => {
  // 标签不是可打开的资源（它的 id 属于标签而非歌单，直接请求会 404）
  if (item.kind === "tag") return;
  const source = platform.value;
  if (item.kind === "album") {
    navigateToAlbum(item.title, { source, albumId: item.id });
  } else if (item.kind === "artist") {
    navigateToArtist(item.title, { source, artistId: item.id });
  } else if (item.kind === "rank") {
    navigateToRank(item.id, { source, name: item.title });
  } else {
    navigateToPlaylist(item.id, { source, name: item.title });
  }
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
      const [groups, hotPlaylists] = await Promise.all([
        fetchQQMusicToplist(),
        // 热门歌单拉不到时不影响榜单展示
        fetchQQMusicHotPlaylists(30).catch(() => [] as QMHotPlaylist[]),
      ]);
      const visible = genreParam ? groups.filter((group) => group.id === genreParam) : groups;
      sections.value = [
        ...(hotPlaylists.length ? [qmHotPlaylistSection(hotPlaylists)] : []),
        ...normalizeQQMusic(visible),
      ];
      genres.value = groupsToGenres(groups);
    } else {
      const [groups, hotPlaylists, newSongs] = await Promise.all([
        fetchKugouRankList(),
        fetchKugouHotPlaylists(1, 30).catch(() => [] as KGHotPlaylist[]),
        fetchKugouNewSongs(30).catch(() => [] as Track[]),
      ]);
      const visible = genreParam ? groups.filter((group) => group.id === genreParam) : groups;
      sections.value = [
        ...(hotPlaylists.length ? [kgHotPlaylistSection(hotPlaylists)] : []),
        ...(newSongs.length ? [kgNewSongSection(newSongs)] : []),
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

        <!-- 分类导航 -->
        <div v-if="genres.length" class="flex flex-wrap gap-1.5">
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
        <section v-for="section in sections" :key="section.key" class="flex flex-col gap-2.5">
          <h2 class="text-base font-semibold text-on-surface">{{ section.title }}</h2>

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
                class="aspect-square w-full overflow-hidden rounded-lg bg-surface-variant/10 transition-transform duration-200 group-hover:scale-[1.03]"
              >
                <SImg v-if="item.image" :src="item.image" :alt="item.title" class="size-full" />
                <div v-else class="flex size-full items-center justify-center">
                  <IconLucideDisc3 class="size-7 text-on-surface-variant/30" />
                </div>
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
