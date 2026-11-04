<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useTimeFormat } from "@/composables/useTimeFormat";
import { useProgressLyric } from "@/composables/useProgressLyric";
import * as player from "@/core/player";

const status = useStatusStore();
const media = useMediaStore();
const { isPlaying, isLoading, position, duration, repeatMode, shuffleMode, heartMode, fmMode } =
  storeToRefs(status);
const hasTrack = computed(() => !!(media.track ?? status.currentTrack));
const { timeDisplay, toggleTimeFormat } = useTimeFormat();
const { snapToNearestLyric } = useProgressLyric();

const onSeekDragEnd = (value: number): void => {
  void player.seek(snapToNearestLyric(value));
};
</script>

<template>
  <div class="w-full min-w-0 shrink-0 flex flex-col items-center gap-1">
    <div class="flex items-center gap-3">
      <SButton
        type="cover"
        variant="ghost"
        circle
        @click="
          fmMode
            ? player.dislikeFmTrack()
            : heartMode
              ? player.exitHeartMode()
              : player.toggleShuffleMode()
        "
      >
        <template #icon>
          <IconLucideHeartOff v-if="fmMode" />
          <IconSpHeartMode v-else-if="heartMode" />
          <IconLucideShuffle v-else-if="shuffleMode === 'on'" />
          <IconSpPlayOrder v-else />
        </template>
      </SButton>
      <SButton
        type="cover"
        variant="ghost"
        circle
        :disabled="!hasTrack || fmMode"
        @click="player.prevTrack()"
      >
        <template #icon><IconLucideSkipBack /></template>
      </SButton>
      <SButton
        type="cover"
        variant="secondary"
        size="large"
        circle
        :loading="isLoading"
        :disabled="!hasTrack && !isLoading"
        @click="player.togglePlay()"
      >
        <template #icon>
          <SIconSwap :active="isPlaying">
            <template #on><IconLucidePause /></template>
            <template #off><IconLucidePlay /></template>
          </SIconSwap>
        </template>
      </SButton>
      <SButton
        type="cover"
        variant="ghost"
        circle
        :disabled="!hasTrack"
        @click="player.nextTrack()"
      >
        <template #icon><IconLucideSkipForward /></template>
      </SButton>
      <SButton
        type="cover"
        variant="ghost"
        circle
        :disabled="fmMode"
        :class="fmMode ? 'opacity-40' : 'opacity-100'"
        @click="player.cycleRepeatMode()"
      >
        <template #icon>
          <IconLucideInfinity v-if="fmMode" />
          <IconLucideRepeat1 v-else-if="repeatMode === 'one'" />
          <IconLucideRepeat v-else :class="repeatMode === 'off' ? 'opacity-40' : undefined" />
        </template>
      </SButton>
    </div>
    <div class="flex items-center gap-2 w-full">
      <span
        class="text-xs text-cover/50 tabular-nums min-w-9 text-center cursor-pointer px-1.5 py-0.5 rounded-md transition-colors hover:bg-cover/10"
        @click="toggleTimeFormat"
      >
        {{ timeDisplay[0] }}
      </span>
      <SSlider
        :model-value="position"
        :min="0"
        :max="duration"
        :step="100"
        :always-show-thumb="false"
        cover
        class="flex-1"
        @drag-end="onSeekDragEnd"
      />
      <span
        class="text-xs text-cover/50 tabular-nums min-w-9 text-center cursor-pointer px-1.5 py-0.5 rounded-md transition-colors hover:bg-cover/10"
        @click="toggleTimeFormat"
      >
        {{ timeDisplay[1] }}
      </span>
    </div>
  </div>
</template>
