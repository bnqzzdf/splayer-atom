<script setup lang="ts">
defineOptions({ name: "LocalList" });

import type { CoverItem } from "@/types/artist";
import type { SSelectOption } from "@/components/ui/SSelect.vue";
import type { AlbumSummary, ArtistSummary } from "@shared/types/library";
import { useLibraryStore } from "@/stores/library";
import CoverList from "@/components/list/CoverList.vue";
import { navigateToAlbum, navigateToArtist } from "@/utils/navigate";
import IconLucideUsers from "~icons/lucide/users";
import IconLucideUserRound from "~icons/lucide/user-round";
import IconLucideMusic from "~icons/lucide/music";
import IconLucideDisc3 from "~icons/lucide/disc-3";
import IconLucideArrowUpDown from "~icons/lucide/arrow-up-down";
import IconLucideArrowDown from "~icons/lucide/arrow-down";
import IconLucideArrowUp from "~icons/lucide/arrow-up";

type Mode = "artist" | "album";
type SortMode = "default" | "addedAt" | "year" | "name" | "artist" | "trackCount";
type SortOrder = "asc" | "desc";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const libraryStore = useLibraryStore();
const { artistAvatars } = storeToRefs(libraryStore);

const mode: Mode = route.name === "album-list" ? "album" : "artist";

const sortMode = ref<SortMode>(mode === "album" ? "addedAt" : "default");
const sortOrder = ref<SortOrder>("desc");

const sortOptions = computed<SSelectOption[]>(() =>
  mode === "album"
    ? [
        { value: "addedAt", label: t("songList.sort.byAddedAt") },
        { value: "year", label: t("songList.sort.byYear") },
        { value: "name", label: t("songList.sort.byName") },
        { value: "artist", label: t("songList.sort.byArtist") },
        { value: "trackCount", label: t("songList.sort.byTrackCount") },
      ]
    : [
        { value: "default", label: t("songList.sort.default") },
        { value: "name", label: t("songList.sort.byName") },
        { value: "trackCount", label: t("songList.sort.byTrackCount") },
      ],
);

const source = shallowRef<ArtistSummary[] | AlbumSummary[]>([]);

type SortableCoverItem = CoverItem & {
  artist?: string;
  year?: number;
  addedAt?: number;
};

const compareOptionalNumber = (a: number | undefined, b: number | undefined): number => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return sortOrder.value === "asc" ? a - b : b - a;
};

/** 组装最终列表 */
const items = computed<CoverItem[]>(() => {
  const list: SortableCoverItem[] =
    mode === "artist"
      ? source.value.map((item: ArtistSummary) => ({
          id: encodeURIComponent(item.name),
          title: item.name,
          cover: artistAvatars.value[item.name.trim().toLowerCase()] ?? item.cover,
          subtitle: t("common.totalSongs", { count: item.trackCount }),
          trackCount: item.trackCount,
        }))
      : (source.value as AlbumSummary[]).map((item) => ({
          id: encodeURIComponent(item.name),
          title: item.name,
          cover: item.cover,
          subtitle: item.artist || t("song.unknownArtist"),
          trackCount: item.trackCount,
          artist: item.artist,
          year: item.year,
          addedAt: item.addedAt,
        }));
  if (sortMode.value === "default") return list;

  const direction = sortOrder.value === "asc" ? 1 : -1;
  list.sort((a, b) => {
    let result = 0;
    switch (sortMode.value) {
      case "addedAt":
        result = compareOptionalNumber(a.addedAt, b.addedAt);
        break;
      case "year":
        result = compareOptionalNumber(a.year, b.year);
        break;
      case "artist":
        result = (a.artist ?? "").localeCompare(b.artist ?? "") * direction;
        break;
      case "trackCount":
        result = (a.trackCount - b.trackCount) * direction;
        break;
      case "name":
        result = a.title.localeCompare(b.title) * direction;
        break;
    }
    return result || a.title.localeCompare(b.title);
  });
  return list;
});

watch(sortMode, (value) => {
  sortOrder.value = value === "name" || value === "artist" ? "asc" : "desc";
});

const config = computed(() =>
  mode === "artist"
    ? {
        title: t("artist.label"),
        countIcon: IconLucideUsers,
        countLabel: t("artist.totalArtists", { count: items.value.length }),
        emptyIcon: IconLucideUserRound,
        coverType: "artist" as const,
        minSize: 120,
        selectWidth: "w-32",
      }
    : {
        title: t("album.label"),
        countIcon: IconLucideDisc3,
        countLabel: t("common.totalAlbums", { count: items.value.length }),
        emptyIcon: IconLucideDisc3,
        coverType: "default" as const,
        minSize: 140,
        selectWidth: "w-40",
      },
);

const handleClick = (item: CoverItem): void => {
  if (mode === "artist") navigateToArtist(item.title);
  else navigateToAlbum(item.title);
};

onMounted(async () => {
  source.value =
    mode === "artist" ? await libraryStore.getArtistList() : await libraryStore.getAlbumList();
  // 拉取当前列表中尚未缓存的歌手头像
  if (mode === "artist") libraryStore.loadArtistAvatars();
});
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="shrink-0 px-5 pb-2">
      <div class="flex items-center justify-between gap-4 mt-2 mb-4">
        <div class="flex items-baseline gap-4">
          <h1 class="text-3xl font-bold text-on-surface text-balance">{{ config.title }}</h1>
          <span
            v-if="items.length > 0"
            class="flex items-center gap-1 text-sm text-on-surface-variant/50"
          >
            <component :is="config.countIcon" class="size-3.5" />
            {{ config.countLabel }}
          </span>
        </div>
        <div
          v-if="items.length > 0"
          class="flex items-center gap-2 text-sm text-on-surface-variant/70"
        >
          <IconLucideArrowUpDown class="size-3.5 shrink-0" />
          <span class="shrink-0">{{ t("songList.sort.mode") }}</span>
          <div :class="[config.selectWidth, 'shrink-0']">
            <SSelect v-model="sortMode" :options="sortOptions" />
          </div>
          <SButton
            v-if="mode === 'album'"
            variant="secondary"
            circle
            :title="t(sortOrder === 'asc' ? 'songList.sort.asc' : 'songList.sort.desc')"
            @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'"
          >
            <template #icon>
              <IconLucideArrowUp v-if="sortOrder === 'asc'" />
              <IconLucideArrowDown v-else />
            </template>
          </SButton>
        </div>
      </div>
    </div>
    <div class="flex-1 min-h-0">
      <CoverList
        v-if="items.length > 0"
        :items="items"
        :type="config.coverType"
        :min-size="config.minSize"
        :padding-x="20"
        :padding-bottom="24"
        @click="handleClick"
      />
      <div v-else class="h-full flex items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <component :is="config.emptyIcon" class="size-12 mx-auto mb-3 opacity-30" />
          <div class="text-sm mb-1">{{ t("library.noLocalData") }}</div>
          <div class="text-xs mb-4 opacity-70">{{ t("library.noLocalDataHint") }}</div>
          <SButton type="primary" variant="secondary" @click="router.push('/library')">
            <template #icon><IconLucideMusic /></template>
            {{ t("library.goLibrary") }}
          </SButton>
        </div>
      </div>
    </div>
  </div>
</template>
