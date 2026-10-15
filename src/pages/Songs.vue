<script setup lang="ts">
defineOptions({ name: "Songs" });

import type { PlaybackContext } from "@shared/types/player";
import { useLibraryStore } from "@/stores/library";
import { useSettingsDialog } from "@/settings/useSettingsDialog";
import SongList from "@/components/list/SongList.vue";
import { formatFileSize } from "@/utils/format";
import * as player from "@/core/player";

const { t } = useI18n();
const libraryStore = useLibraryStore();
const settingsDialog = useSettingsDialog();
const { tracks, tracksLoadState, tracksLoadError } = storeToRefs(libraryStore);

const playbackContext = computed<PlaybackContext>(() => ({
  originId: "songs",
  originType: "page",
  originName: t("nav.songs"),
}));

const searchQuery = ref("");
const songListRef = shallowRef<InstanceType<typeof SongList> | null>(null);

const totalSize = computed(() => {
  const bytes = tracks.value.reduce((sum, track) => sum + (track.fileSize ?? 0), 0);
  return bytes > 0 ? formatFileSize(bytes) : "";
});

const handlePlayAll = (): void => {
  if (tracks.value.length === 0) return;
  player.playFrom(tracks.value, 0, playbackContext.value);
};

const ensureTracksLoaded = (): void => {
  if (tracksLoadState.value === "idle" || tracksLoadState.value === "error") {
    void libraryStore.load();
  }
};

onMounted(ensureTracksLoaded);
onActivated(ensureTracksLoaded);
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="shrink-0 px-5 pb-2">
      <div class="flex items-center justify-between mt-2 mb-4">
        <div class="flex items-baseline gap-4">
          <h1 class="text-3xl font-bold text-on-surface text-balance">{{ t("nav.songs") }}</h1>
          <div
            v-if="tracks.length > 0"
            class="flex items-center gap-3 text-sm text-on-surface-variant/50"
          >
            <span class="flex items-center gap-1">
              <IconLucideMusic class="size-3.5" />
              {{ t("common.totalSongs", { count: tracks.length }) }}
            </span>
            <span v-if="totalSize" class="flex items-center gap-1">
              <IconLucideHardDrive class="size-3.5" />
              {{ totalSize }}
            </span>
          </div>
        </div>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <div class="flex items-center gap-2">
          <SButton
            type="primary"
            variant="secondary"
            round
            :disabled="tracks.length === 0"
            @click="handlePlayAll"
          >
            <template #icon><IconLucidePlay /></template>
            {{ t("common.playAll") }}
          </SButton>
          <SButton
            variant="secondary"
            round
            :disabled="tracks.length === 0"
            @click="songListRef?.enterBatch()"
          >
            <template #icon><IconLucideListChecks /></template>
            {{ t("songList.batch.manage") }}
          </SButton>
        </div>
        <SInput
          v-model="searchQuery"
          :placeholder="t('common.search')"
          clearable
          round
          class="w-full sm:w-40 sm:focus-within:w-56"
          data-search-input
        >
          <template #prefix>
            <IconLucideSearch class="size-4 text-on-surface-variant/40 shrink-0" />
          </template>
        </SInput>
      </div>
    </div>
    <div
      v-if="tracksLoadState === 'error'"
      role="alert"
      :title="tracksLoadError ?? undefined"
      class="flex items-center justify-center gap-3 px-5 py-4 text-sm text-on-surface-variant"
      :class="tracks.length > 0 ? 'shrink-0' : 'flex-1'"
    >
      <span>{{ t(tracks.length > 0 ? "library.refreshFailed" : "library.loadFailed") }}</span>
      <SButton variant="secondary" @click="libraryStore.load">{{ t("common.retry") }}</SButton>
    </div>
    <div v-if="tracks.length > 0" class="flex-1 min-h-0">
      <SongList
        ref="songListRef"
        :items="tracks"
        :search-query="searchQuery"
        :playback-context="playbackContext"
        enable-sort
        show-size
      />
    </div>
    <div
      v-else-if="tracksLoadState === 'idle' || tracksLoadState === 'loading'"
      role="status"
      class="flex-1 flex items-center justify-center gap-2 text-sm text-on-surface-variant/50"
    >
      <SLoading class="size-5" />
      {{ t("common.loading") }}
    </div>
    <div v-else-if="tracksLoadState === 'success'" class="flex-1 flex items-center justify-center">
      <div class="text-center text-on-surface-variant/50">
        <IconLucideMusic class="size-12 mx-auto mb-3 opacity-30" />
        <div class="text-sm mb-1">{{ t("library.noLocalSongs") }}</div>
        <div class="text-xs mb-4 opacity-70">{{ t("library.configureHint") }}</div>
        <SButton type="primary" variant="secondary" @click="settingsDialog.show('localLibrary')">
          <template #icon><IconLucideSettings2 /></template>
          {{ t("library.openSettings") }}
        </SButton>
      </div>
    </div>
  </div>
</template>
