<script setup lang="ts">
/**
 * 在线平台分区「查看全部」。
 *
 * 官方（Qobuz 的 See all、TIDAL 的 View all）在每个分区右上角给入口，点进去是该分区的
 * 完整列表。这里按平台各自的翻页方式取数据：
 *   Qobuz: `discover/section`（container 键 → 端点名，带 limit/offset）
 *   TIDAL: `pages/data/<uuid>`（首页模块自带的 dataApiPath，带 limit/offset）
 *
 * 定位信息全部走 URL query，所以这个页面可以独立刷新，链接也能直接分享；
 * 也正因为如此，`section` 段用的是「平台自己认识的那个键」（Qobuz 是 container 键，
 * TIDAL 是 dataApiPath），而不是首页内部的行列下标。
 */
defineOptions({ name: "PlatformSection" });

import type { CoverItem } from "@/types/artist";
import CoverList from "@/components/list/CoverList.vue";
import * as qobuzApi from "@/apis/qobuz";
import * as tidalApi from "@/apis/tidal";
import {
  asArray,
  asRecord,
  homeItemToCoverItem,
  openPlatformHomeItem,
  qobuzSectionEndpoint,
  toQobuzItem,
  toTidalItem,
  type HomeItem,
  type Platform,
} from "@/services/platformHome";
import IconLucideArrowLeft from "~icons/lucide/arrow-left";

const { t, locale } = useI18n();
const router = useRouter();
const route = useRoute();

/** 每页条数：与首页一次拉取的量级一致，避免首屏过重 */
const PAGE_SIZE = 30;

const platform = computed(() => String(route.params.platform ?? "") as Platform);
const sectionKey = computed(() => String(route.params.section ?? ""));
const title = computed(() => String(route.query.title ?? ""));
const genre = computed(() => (route.query.genre ? String(route.query.genre) : undefined));
/** TIDAL 首页模块的数据路径（已去掉 `pages/` 前缀） */
const tidalPath = computed(() => (route.query.path ? String(route.query.path) : undefined));
const tidalModuleType = computed(() => (route.query.type ? String(route.query.type) : ""));

const homeItems = ref<HomeItem[]>([]);
const loading = ref(false);
const loadingMore = ref(false);
const hasMore = ref(false);
const error = ref("");
/** 翻页游标：已取到的条目数 */
let offset = 0;

/** CoverList 只认 CoverItem，点击时再按 id 找回 HomeItem（跳转要靠它的 kind） */
const items = computed<CoverItem[]>(() => homeItems.value.map(homeItemToCoverItem));

/**
 * 取一页。
 *
 * 两个平台的分页响应形状刚好一致：都直接给 `items`，并且都能判断「还有没有下一页」
 * （Qobuz 用 `has_more`，TIDAL 用 `totalNumberOfItems`）。
 */
const fetchPage = async (): Promise<{ list: HomeItem[]; more: boolean }> => {
  if (platform.value === "qobuz") {
    const endpoint = qobuzSectionEndpoint(sectionKey.value);
    if (!endpoint) throw new Error(t("platformSection.unsupported"));
    const data = await qobuzApi.discoverSection(endpoint, {
      ...(genre.value ? { genre_id: genre.value } : {}),
      limit: PAGE_SIZE,
      offset,
    });
    return {
      list: asArray(data.items)
        .map(toQobuzItem)
        .filter((entry): entry is HomeItem => entry !== null),
      more: data.has_more === true,
    };
  }

  const path = tidalPath.value;
  if (!path) throw new Error(t("platformSection.unsupported"));
  // TIDAL 的模块数据端点是少数**必须**带 locale 的接口（缺了回 400
  // "locale or deviceType missing"），所以这里显式带上当前语言。
  const data = asRecord(
    await tidalApi.pagesGet(path, { limit: PAGE_SIZE, offset, locale: locale.value }),
  );
  const list = asArray(data.items)
    .map((entry) => toTidalItem(entry, tidalModuleType.value))
    .filter((entry): entry is HomeItem => entry !== null);
  const total = typeof data.totalNumberOfItems === "number" ? data.totalNumberOfItems : undefined;
  return {
    list,
    more: total === undefined ? list.length >= PAGE_SIZE : offset + list.length < total,
  };
};

const load = async (): Promise<void> => {
  loading.value = true;
  error.value = "";
  offset = 0;
  homeItems.value = [];
  hasMore.value = false;
  try {
    const { list, more } = await fetchPage();
    homeItems.value = list;
    offset = list.length;
    hasMore.value = more;
    if (!list.length) error.value = t("platformHome.empty");
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("platformHome.loadFailed");
  } finally {
    loading.value = false;
  }
};

const loadMore = async (): Promise<void> => {
  if (loading.value || loadingMore.value || !hasMore.value) return;
  loadingMore.value = true;
  try {
    const { list, more } = await fetchPage();
    homeItems.value = [...homeItems.value, ...list];
    offset += list.length;
    // 返回空页时停手，否则游标不前进会反复请求同一页
    hasMore.value = more && list.length > 0;
  } catch (err) {
    // 翻页失败保留已加载内容，只停下继续加载，并把原因显示出来
    hasMore.value = false;
    error.value = err instanceof Error ? err.message : t("platformHome.loadFailed");
  } finally {
    loadingMore.value = false;
  }
};

const openItem = (cover: CoverItem): void => {
  const item = homeItems.value.find((entry) => entry.id === cover.id);
  if (item) openPlatformHomeItem(item, platform.value);
};

/** 直接打开链接时没有上一页可回，退回平台首页 */
const goBack = (): void => {
  if (window.history.state?.back) router.back();
  else void router.push({ name: "platforms" });
};

watch([platform, sectionKey, tidalPath, genre], () => void load(), { immediate: true });
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex shrink-0 items-center gap-2 px-5 pt-4 pb-2">
      <button
        type="button"
        class="flex shrink-0 items-center gap-1 text-sm text-on-surface-variant transition-colors hover:text-primary"
        @click="goBack"
      >
        <IconLucideArrowLeft class="size-4" />
        {{ t("platformSection.back") }}
      </button>
      <h1 class="truncate text-base font-semibold text-on-surface">{{ title }}</h1>
    </div>

    <div
      v-if="loading && !items.length"
      class="flex flex-1 items-center justify-center text-sm text-on-surface-variant"
    >
      {{ t("common.loading") }}
    </div>
    <div
      v-else-if="error && !items.length"
      class="flex flex-1 items-center justify-center px-6 text-center text-sm text-on-surface-variant"
    >
      {{ error }}
    </div>
    <div v-else class="min-h-0 flex-1">
      <CoverList
        :items="items"
        :padding-x="20"
        :padding-top="4"
        :padding-bottom="20"
        :has-more="hasMore"
        :loading-more="loadingMore"
        @click="openItem"
        @reach-bottom="loadMore"
      />
    </div>
  </div>
</template>
