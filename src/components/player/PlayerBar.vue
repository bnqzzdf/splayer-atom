<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { useMediaStore } from "@/stores/media";
import { useFavorite } from "@/composables/useFavorite";
import { usePlaylistPicker } from "@/composables/usePlaylistPicker";
import { useTrackMenu } from "@/composables/useTrackMenu";
import { useDownload } from "@/composables/useDownload";
import { useProgressLyric } from "@/composables/useProgressLyric";
import { useResponsiveLayout } from "@/composables/useResponsiveLayout";
import * as player from "@/core/player";
import IconFavorite from "~icons/material-symbols/favorite-rounded";
import IconFavoriteOutline from "~icons/material-symbols/favorite-outline-rounded";
import IconLucideMoreHorizontal from "~icons/lucide/more-horizontal";
import IconLucidePlay from "~icons/lucide/play";
import IconLucidePause from "~icons/lucide/pause";
import IconLucideSkipForward from "~icons/lucide/skip-forward";

const status = useStatusStore();
const settings = useSettingsStore();
const media = useMediaStore();
const fav = useFavorite();
const { position, duration } = storeToRefs(status);
const { formatTooltip, snapToNearestLyric } = useProgressLyric();
const { isMobile, isDesktop } = useResponsiveLayout();

/** 是否是浮动模式（仅宽屏生效） */
const isFloating = computed(() => isDesktop.value && settings.appearance.layoutMode === "floating");
/** 是否显示进度条提示 */
const showTooltip = computed(() => settings.player.showProgressTooltip);

const onSeekDragEnd = (value: number): void => {
  const snappedValue = snapToNearestLyric(value);
  player.seek(snappedValue);
};

/** 添加到歌单 */
const {
  open: pickerOpen,
  tracks: pickerTracks,
  mode: pickerMode,
  openPicker,
} = usePlaylistPicker();

/** 歌曲菜单 */
const { enqueue: enqueueDownload } = useDownload();
const { items: menuItems, handleSelect: onMenuSelect } = useTrackMenu(toRef(media, "track"), {
  hidePlayActions: true,
  onAddToPlaylist: (track) => openPicker([track]),
  onDownload: (track, quality) => void enqueueDownload(track, { quality }),
});
</script>

<template>
  <!-- 手机紧凑双行布局（<768px） -->
  <div v-if="isMobile" class="relative flex flex-col px-3 pt-0.5 pb-2 min-w-0">
    <!-- 顶部进度条：细轨道，至少 24px 触摸高度 -->
    <div class="h-6 -mt-1 flex items-center">
      <SSlider
        :model-value="position"
        :min="0"
        :max="duration"
        :step="100"
        :track-height="3"
        :thumb-size="10"
        :always-show-thumb="false"
        :show-popover="showTooltip"
        :disabled="!media.track"
        class="flex-1"
        @drag-end="onSeekDragEnd"
      >
        <template #popover="{ value }">{{ formatTooltip(value) }}</template>
      </SSlider>
    </div>

    <!-- 第一行（起步 56px）：44px 封面、可收缩的曲名/艺人、播放暂停、下一首 -->
    <div class="min-h-14 flex items-center justify-between gap-2 min-w-0">
      <TrackInfo compact class="flex-1 min-w-0" />
      <div class="flex items-center gap-1 shrink-0">
        <SButton
          type="primary"
          variant="secondary"
          circle
          ripple
          :size="40"
          :loading="status.isLoading"
          :disabled="!media.track && !status.isLoading"
          @click="player.togglePlay()"
        >
          <template #icon>
            <SIconSwap :active="status.isPlaying">
              <template #on><IconLucidePause class="size-5" /></template>
              <template #off><IconLucidePlay class="size-5" /></template>
            </SIconSwap>
          </template>
        </SButton>
        <SButton
          type="primary"
          variant="ghost"
          circle
          ripple
          :size="36"
          :disabled="!media.track"
          @click="player.nextTrack()"
        >
          <template #icon><IconLucideSkipForward class="size-4.5" /></template>
        </SButton>
      </div>
    </div>

    <!-- 第二行（起步 44px）：输出设备、队列、播放模式与工具 -->
    <div
      class="min-h-11 flex items-center justify-between gap-1 min-w-0 pt-0.5 border-t border-t-solid border-t-on-surface/5"
    >
      <Toolbar compact />
    </div>
  </div>

  <!-- 宽屏浮动模式 -->
  <div v-else-if="isFloating" class="relative flex items-center px-4 gap-4 min-w-0">
    <PlayerControls compact />
    <div class="flex flex-col flex-1 min-w-0 gap-1 pt-2 pb-1">
      <div class="flex items-center gap-2 min-w-0">
        <TrackInfo compact class="flex-1">
          <template #title-trailing>
            <div class="flex items-center shrink-0">
              <SButton
                class="-my-1"
                type="primary"
                variant="text"
                circle
                :size="24"
                :icon-size="16"
                @click="fav.toggle(media.track)"
              >
                <template #icon>
                  <SIconSwap :active="fav.isLiked(media.track)">
                    <template #on><IconFavorite /></template>
                    <template #off><IconFavoriteOutline /></template>
                  </SIconSwap>
                </template>
              </SButton>
              <SDropdownMenu
                v-if="media.track"
                :items="menuItems"
                side="top"
                align="start"
                @select="onMenuSelect"
              >
                <template #trigger>
                  <SButton
                    class="-my-1"
                    type="primary"
                    variant="text"
                    circle
                    :size="24"
                    :icon-size="16"
                  >
                    <template #icon><IconLucideMoreHorizontal /></template>
                  </SButton>
                </template>
              </SDropdownMenu>
            </div>
          </template>
        </TrackInfo>
        <PlayerTimeInfo compact />
      </div>
      <SSlider
        :model-value="position"
        :min="0"
        :max="duration"
        :step="100"
        :track-height="3"
        :thumb-size="10"
        :always-show-thumb="false"
        :show-popover="showTooltip"
        :disabled="!media.track"
        @drag-end="onSeekDragEnd"
      >
        <template #popover="{ value }">{{ formatTooltip(value) }}</template>
      </SSlider>
    </div>
    <div class="shrink-0">
      <Toolbar />
    </div>
  </div>

  <!-- 桌面/平板默认模式 -->
  <div v-else class="relative h-full">
    <div class="absolute left-0 right-0 top-0 -translate-y-1/2 z-10">
      <SSlider
        :model-value="position"
        :min="0"
        :max="duration"
        :step="100"
        :track-height="3"
        :thumb-size="12"
        :always-show-thumb="false"
        :show-popover="showTooltip"
        :disabled="!media.track"
        @drag-end="onSeekDragEnd"
      >
        <template #popover="{ value }">{{ formatTooltip(value) }}</template>
      </SSlider>
    </div>
    <div class="grid grid-cols-[1fr_auto_1fr] items-center h-full px-3 gap-3">
      <TrackInfo>
        <template #title-trailing>
          <div class="flex items-center shrink-0">
            <SButton
              class="-my-1"
              type="primary"
              variant="text"
              circle
              :size="28"
              :icon-size="18"
              @click="fav.toggle(media.track)"
            >
              <template #icon>
                <SIconSwap :active="fav.isLiked(media.track)">
                  <template #on><IconFavorite /></template>
                  <template #off><IconFavoriteOutline /></template>
                </SIconSwap>
              </template>
            </SButton>
            <SDropdownMenu
              v-if="media.track"
              :items="menuItems"
              side="top"
              align="start"
              @select="onMenuSelect"
            >
              <template #trigger>
                <SButton
                  class="-my-1"
                  type="primary"
                  variant="text"
                  circle
                  :size="28"
                  :icon-size="18"
                >
                  <template #icon><IconLucideMoreHorizontal /></template>
                </SButton>
              </template>
            </SDropdownMenu>
          </div>
        </template>
      </TrackInfo>
      <PlayerControls class="mx-4 md:mx-15" />
      <div class="flex items-center justify-end gap-2 min-w-0">
        <PlayerTimeInfo />
        <Toolbar />
      </div>
    </div>
  </div>
  <PlaylistPickerDialog v-model:open="pickerOpen" :mode="pickerMode" :tracks="pickerTracks" />
</template>
