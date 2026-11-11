<script setup lang="ts">
defineOptions({ name: "Stats" });

import type {
  DailyPlayStats,
  HourlyPlayStats,
  LibraryStats,
  TopAlbum,
  TopArtist,
  TopTrack,
} from "@shared/types/stats";
import { useFloatingPlayerBar } from "@/composables/useFloatingPlayerBar";
import { statsClient } from "@/core/statsClient";

const { isFloatingBar } = useFloatingPlayerBar();

const libraryStats = ref<LibraryStats | null>(null);
const daily = ref<DailyPlayStats[]>([]);
const hourly = ref<HourlyPlayStats[]>([]);
const topSongs = shallowRef<TopTrack[]>([]);
const topAlbums = shallowRef<TopAlbum[]>([]);
const topArtists = shallowRef<TopArtist[]>([]);
const loading = ref(true);
let disposed = false;

onBeforeUnmount(() => {
  disposed = true;
});

onMounted(async () => {
  try {
    const [library, history, hourlyHistory, songs, albums, artists] = await Promise.allSettled([
      statsClient.getLibraryStats(),
      statsClient.getPlayHistoryDaily(90),
      statsClient.getPlayHistoryHourly(),
      statsClient.getTopTracks(10),
      statsClient.getTopAlbums(10),
      statsClient.getTopArtists(10),
    ]);
    if (disposed) return;
    if (library.status === "fulfilled") libraryStats.value = library.value;
    if (history.status === "fulfilled") daily.value = history.value;
    if (hourlyHistory.status === "fulfilled") hourly.value = hourlyHistory.value;
    if (songs.status === "fulfilled") topSongs.value = songs.value;
    if (albums.status === "fulfilled") topAlbums.value = albums.value;
    if (artists.status === "fulfilled") topArtists.value = artists.value;
  } finally {
    if (!disposed) loading.value = false;
  }
});
</script>

<template>
  <div class="h-full overflow-y-auto [scrollbar-gutter:stable]">
    <div
      class="mx-auto flex max-w-[1400px] flex-col gap-5 px-3 sm:px-5 pt-2"
      :class="isFloatingBar ? 'pb-28' : 'pb-6 sm:pb-10'"
    >
      <!-- 曲库概览 -->
      <StatsOverview :stats="libraryStats" />
      <!-- 聆听足迹、播放时段与音质构成 -->
      <StatsHeatmap :daily="daily" :hourly="hourly" :stats="libraryStats" :loading="loading" />
      <!-- 最常听榜单 -->
      <StatsTopList
        :songs="topSongs"
        :albums="topAlbums"
        :artists="topArtists"
        :loading="loading"
      />
    </div>
  </div>
</template>
