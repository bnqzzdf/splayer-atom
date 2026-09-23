<script setup lang="ts">
/**
 * 在线平台首页（Qobuz / TIDAL）
 *
 * 只展示**已登录**的平台，每个平台按标签切换，内容为该平台的
 * 分类导航 + 官方首页分区（榜单/新发行/推荐歌单等）。
 *
 * 两个平台的数据结构完全不同，这里统一归一化成 HomeSection：
 *   Qobuz: { containers: { <key>: { data: { items } } } }
 *   TIDAL: { rows: [{ modules: [{ type, items }] }] }
 * 页面只渲染 HomeSection，不关心平台差异。
 */
defineOptions({ name: "PlatformHome" });

import { useProviderSessionsStore } from "@/stores/providerSessions";
import * as qobuzApi from "@/apis/qobuz";
import * as tidalApi from "@/apis/tidal";
import { resolveQobuzCover } from "@/utils/format/qobuz";
import { resolveTidalCover } from "@/utils/format/tidal";
import { navigateToAlbum, navigateToArtist, navigateToPlaylist } from "@/utils/navigate";
import IconLucideRefreshCw from "~icons/lucide/refresh-cw";
import IconLucideMusic from "~icons/lucide/music";
import IconLucideDisc3 from "~icons/lucide/disc-3";

const { t } = useI18n();
const providerSessions = useProviderSessionsStore();

type Platform = "qobuz" | "tidal";

/** 归一化后的首页条目 */
interface HomeItem {
  id: string;
  title: string;
  subtitle?: string;
  image?: string;
  /** 决定点击后跳哪种详情页 */
  kind: "album" | "playlist" | "track" | "artist";
}

/** 归一化后的分区 */
interface HomeSection {
  key: string;
  title: string;
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

/** 已登录的平台才显示标签 */
const loggedInPlatforms = computed<Platform[]>(() =>
  (["qobuz", "tidal"] as Platform[]).filter((p) => providerSessions.sessions[p]?.authenticated),
);

const platformTabs = computed(() =>
  loggedInPlatforms.value.map((p) => ({
    key: p,
    label: p === "qobuz" ? "Qobuz" : "TIDAL",
  })),
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
  return {
    id,
    title,
    subtitle: artists || str(item.description)?.slice(0, 48),
    // 复用 format/qobuz 的封面解析：它已覆盖专辑 {large,small} 与歌单 {covers:[...]}
    // 两种结构，并统一走 /api/proxy/image。
    image: resolveQobuzCover(item, 300),
    // 专辑带 track_count；歌单/其它走 playlist 详情页
    kind: item.track_count != null ? "album" : "playlist",
  };
};

const normalizeQobuz = (data: unknown): HomeSection[] => {
  const containers = asRecord(asRecord(data).containers);
  return Object.entries(containers)
    .map(([key, value]) => {
      const items = asArray(asRecord(asRecord(value).data).items)
        .map(toQobuzItem)
        .filter((x): x is HomeItem => x !== null);
      return { key, title: qobuzSectionTitle(key), items };
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
        title: str(moduleRecord.title) ?? str(rowRecord.title) ?? tidalModuleTitle(type),
        items,
      });
    });
  });
  return out;
};

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
  const source = platform.value;
  if (item.kind === "album") {
    navigateToAlbum(item.title, { source, albumId: item.id });
  } else if (item.kind === "artist") {
    navigateToArtist(item.title, { source, artistId: item.id });
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
    } else {
      const [home, genreData] = await Promise.all([
        tidalApi.pagesHome(),
        tidalApi.genres().catch(() => []),
      ]);
      sections.value = normalizeTidal(home);
      genres.value = normalizeGenres("tidal", genreData);
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
        <div v-else-if="error" class="py-16 text-center text-sm text-on-surface-variant">
          {{ error }}
        </div>

        <!-- 分区列表 -->
        <section v-for="section in sections" :key="section.key" class="flex flex-col gap-2.5">
          <h2 class="text-base font-semibold text-on-surface">{{ section.title }}</h2>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
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
  </div>
</template>
