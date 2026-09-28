/**
 * 在线平台首页的共享模型与归一化。
 *
 * 首页（PlatformHome）与「查看全部」分区页（PlatformSection）需要同一套
 * 条目模型与字段解析：封面、副标题、音质徽标、点击目标。放在这里而不是各自复制，
 * 是为了让「同一个条目在两个页面长得一样、点了去同一个地方」这件事只有一个实现。
 *
 * 平台原始结构差异很大，这里只做归一化，不认识渲染：
 *   Qobuz: { containers: { <key>: { data: { items, has_more } } } }
 *   TIDAL: { rows: [{ modules: [{ type, title, pagedList: { items, dataApiPath } }] }] }
 */
import type { CoverItem } from "@/types/artist";
import { resolveQobuzCover } from "@/utils/format/qobuz";
import { resolveTidalCover } from "@/utils/format/tidal";
import {
  navigateToAlbum,
  navigateToArtist,
  navigateToPlaylist,
  navigateToRank,
} from "@/utils/navigate";

export type Platform = "qobuz" | "tidal" | "qqmusic" | "kugou";

/**
 * 平台标签顺序（也是「已登录平台」的展示顺序）。
 *
 * 与 `@shared/types/platform` 的同名常量**不是**同一份：那份管搜索页与标签编辑器、
 * 含网易云；这份只管「流媒体接入」页的标签，按使用频率排。
 */
export const ALL_PLATFORMS: Platform[] = ["qqmusic", "qobuz", "tidal", "kugou"];

export const PLATFORM_LABELS: Record<Platform, string> = {
  qobuz: "Qobuz",
  tidal: "TIDAL",
  qqmusic: "QQ音乐",
  kugou: "酷狗音乐",
};

/** 归一化后的首页条目 */
export interface HomeItem {
  id: string;
  title: string;
  subtitle?: string;
  image?: string;
  /**
   * 音质徽标（Hi-Res / Atmos）。
   *
   * 只在平台确实声明了该规格时才有值：Qobuz 看 `audio_info`，TIDAL 看
   * `mediaMetadata.tags`。判不出来就不打标，宁可少标也不要错标。
   */
  badge?: string;
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

/**
 * 「查看全部」需要的定位信息。
 *
 * 两个平台翻页方式不同，所以这里同时保留了「路由里用什么当 key」和
 * 「真正拿去请求什么」：Qobuz 用分区端点名 + 流派，TIDAL 用首页模块的 dataApiPath。
 */
export interface SectionMore {
  platform: Platform;
  /** 路由 `:section` 段 */
  section: string;
  /** Qobuz 流派筛选 */
  genre?: string;
  /** TIDAL 模块数据路径（`data/<uuid>`，可直接交给 pages_get） */
  path?: string;
  /**
   * TIDAL 模块类型（`ALBUM_LIST` / `PLAYLIST_LIST` …）。
   *
   * 翻页返回的条目本身不带可靠的类型信息（专辑项没有 type 字段），
   * 而「点进去是专辑还是歌单」全靠它，所以必须从首页带到分区页。
   */
  moduleType?: string;
}

/** 归一化后的分区 */
export interface HomeSection {
  key: string;
  title: string;
  /** cards：封面卡片；tags：纯标签行 */
  variant: "cards" | "tags";
  items: HomeItem[];
  /** 该分区在平台侧还有更多条目时才给出，用于渲染「查看全部」 */
  more?: SectionMore;
}

// ---------- 宽松取值 ----------

export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

export const str = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
};

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

// ---------- 音质徽标 ----------

/**
 * Qobuz 的 Hi-Res 判定。
 *
 * 官方在封面上打 `Hi-Res`，依据就是 `audio_info`：位深高于 16 位，或采样率高于 48 kHz。
 * 实测 `discover/index` 与 `discover/section` 的每个专辑条目都自带 `audio_info`
 * （24/96、24/192、24/48、24/44.1 都有），所以不需要为了这个徽标多发一次请求。
 */
export const qobuzAudioBadge = (raw: unknown): string | undefined => {
  const info = asRecord(asRecord(raw).audio_info);
  const depth = num(info.maximum_bit_depth);
  const rate = num(info.maximum_sampling_rate);
  if (depth === undefined && rate === undefined) return undefined;
  return (depth ?? 0) > 16 || (rate ?? 0) > 48 ? "Hi-Res" : undefined;
};

/**
 * TIDAL 的封面上限徽标。
 *
 * TIDAL 用 `mediaMetadata.tags` 表达这张专辑「能以什么规格取到」：
 * 实测 `audioQuality` 只写当前档（`LOSSLESS`），光看它会整片漏掉 Hi-Res，
 * 真正说明可用规格的是 tags 里的 `HIRES_LOSSLESS` / `DOLBY_ATMOS`。
 * 文案统一用 `Hi-Res`（与 Qobuz 一致），空间音频单独标 `Atmos`。
 */
export const tidalAudioBadge = (raw: unknown): string | undefined => {
  const item = asRecord(raw);
  const tags = asArray(asRecord(item.mediaMetadata).tags).map((tag) => String(tag).toUpperCase());
  if (tags.includes("DOLBY_ATMOS")) return "Atmos";
  if (tags.includes("HIRES_LOSSLESS")) return "Hi-Res";
  if (str(item.audioQuality)?.toUpperCase() === "HI_RES_LOSSLESS") return "Hi-Res";
  return undefined;
};

// ---------- 条目归一化 ----------

/** Qobuz 条目 → HomeItem（专辑与歌单字段不同，按有无 track_count 区分） */
export const toQobuzItem = (raw: unknown): HomeItem | null => {
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
    badge: qobuzAudioBadge(item),
    kind: isTag ? "tag" : item.track_count != null ? "album" : "playlist",
  };
};

/**
 * TIDAL 条目 → HomeItem。
 *
 * 封面字段按类型分布：歌单在 squareImage（其 image 是矩形编辑图，取 640 会 403）、
 * 专辑在 cover、曲目在 album.cover。这里交给 format/tidal 的 resolveTidalCover，
 * 它已实现该优先级并统一走 /api/proxy/image。
 */
export const toTidalItem = (raw: unknown, moduleType: string): HomeItem | null => {
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
    badge: tidalAudioBadge(item),
    kind: targetKind,
  };
};

// ---------- 分区翻页定位 ----------

/**
 * Qobuz `discover/index` 的 container 键 → `discover/section` 端点名。
 *
 * 两处拼写并不一致：容器是 snake_case，端点是 camelCase，`press_awards` 还是复数。
 * 原生侧对端点名做了白名单，所以必须是精确映射；表里没有的容器不支持翻页
 * （`banners` / `recent_releases` / `playlists_tags` 这些平台本身也没有更多条目）。
 */
const QOBUZ_SECTION_ENDPOINTS: Record<string, string> = {
  album_of_the_week: "albumOfTheWeek",
  ideal_discography: "idealDiscography",
  most_streamed: "mostStreamed",
  new_releases: "newReleases",
  playlists: "playlists",
  press_awards: "pressAward",
  qobuzissims: "qobuzissims",
};

/** Qobuz container 键 → 可翻页的端点名；undefined 表示该容器不支持「查看全部」 */
export const qobuzSectionEndpoint = (key: string): string | undefined =>
  QOBUZ_SECTION_ENDPOINTS[key];

/** Qobuz 分区标题（平台返回的是容器键，不是给人看的文案） */
export const qobuzSectionTitle = (key: string): string => {
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

/**
 * TIDAL 模块 → 可翻页的数据路径。
 *
 * `pages/home` 的每个模块带 `pagedList.dataApiPath`（形如 `pages/data/<uuid>`）
 * 与 `totalNumberOfItems`；官方「View all」就是拿这个路径继续翻页。
 * 原生 `pages_get` 拼的是 `pages/{pageId}`，所以这里去掉 `pages/` 前缀。
 */
export const tidalModulePath = (pagedList: unknown): string | undefined => {
  const path = str(asRecord(pagedList).dataApiPath);
  if (!path) return undefined;
  const stripped = path.replace(/^pages\//, "");
  return stripped.includes("/") ? stripped : undefined;
};

// ---------- 渲染与跳转 ----------

/** HomeItem → CoverCard / CoverList 使用的 CoverItem */
export const homeItemToCoverItem = (item: HomeItem): CoverItem => ({
  id: item.id,
  title: item.title,
  cover: item.image,
  subtitle: item.subtitle,
  trackCount: 0,
  badge: item.badge,
});

/**
 * 打开条目对应的详情页。
 *
 * 详情页本身已支持 qobuz/tidal（services/collection 里有对应 loader），
 * 所以这里只需把 source/id 传过去。标签不是可打开的资源（它的 id 属于标签而非歌单，
 * 直接请求会 404），直接忽略。
 */
export const openPlatformHomeItem = (item: HomeItem, platform: Platform): void => {
  if (item.kind === "tag") return;
  if (item.kind === "album") {
    navigateToAlbum(item.title, { source: platform, albumId: item.id });
  } else if (item.kind === "artist") {
    navigateToArtist(item.title, { source: platform, artistId: item.id });
  } else if (item.kind === "rank") {
    navigateToRank(item.id, { source: platform, name: item.title });
  } else {
    navigateToPlaylist(item.id, { source: platform, name: item.title });
  }
};
