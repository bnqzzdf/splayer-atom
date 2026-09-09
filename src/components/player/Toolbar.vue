<script setup lang="ts">
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import OutputDeviceSelector from "@/web/OutputDeviceSelector.vue";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import * as player from "@/core/player";
import { useDirectModeState } from "@/core/player/directMode";
import { getOutputDisplayName, getOutputKind } from "@/core/outputDevices";
import { hasHostCapability, isWebRemote } from "@/runtime";
import IconLucideSliders from "~icons/lucide/sliders-horizontal";
import IconLucideGauge from "~icons/lucide/gauge";
import IconLucideMoreVertical from "~icons/lucide/more-vertical";
import IconLucideClock from "~icons/lucide/clock";
import IconLucideRepeat2 from "~icons/lucide/repeat-2";
import IconLucideRadio from "~icons/lucide/radio";
import IconLucideSpeaker from "~icons/lucide/speaker";
import IconLucideCast from "~icons/lucide/cast";

const props = withDefaults(
  defineProps<{
    /** 是否使用封面主题 */
    cover?: boolean;
  }>(),
  { cover: false },
);

const { t } = useI18n();
const status = useStatusStore();
const settings = useSettingsStore();
const { isDesktopLyricOpen } = storeToRefs(settings);
const { remoteSelected, sampleControlsUnavailable: processingLocked } = useDirectModeState();
const webRemote = isWebRemote();
const desktopLyricAvailable = hasHostCapability("desktopLyric");
const outputPopoverOpen = ref(false);
const outputSelectionRequired = computed(
  () => webRemote && status.outputDevicesReady && status.selectedOutputDevice === null,
);
let initialOutputPromptHandled = false;

const buttonType = computed<"default" | "cover">(() => (props.cover ? "cover" : "default"));
const mutedClass = computed(() => (props.cover ? "text-cover/50" : "text-on-surface-variant"));

const lyricButtonType = computed(() =>
  isDesktopLyricOpen.value ? (props.cover ? "cover" : "primary") : buttonType.value,
);

const volumePercent = computed(() => Math.round(status.volume * 100));
const selectedOutputDevice = computed(() =>
  status.outputDevices.find((device) => device.id === status.selectedOutputDevice),
);
const selectedOutputLabel = computed(() => {
  const selected = status.selectedOutputDevice;
  if (!selected) return t("settings.outputDevice.required");
  return selectedOutputDevice.value ? getOutputDisplayName(selectedOutputDevice.value) : selected;
});
const selectedOutputKind = computed(() => getOutputKind(status.selectedOutputDevice));
const selectedOutputIcon = computed(() => {
  if (selectedOutputKind.value === "upnp") return IconLucideCast;
  return IconLucideSpeaker;
});
const processingUnavailableTitle = computed(() =>
  remoteSelected.value
    ? t("remoteOutput.processingUnavailable")
    : t("directMode.processingUnavailable"),
);

watch(
  [() => status.outputDevicesReady, () => status.selectedOutputDevice],
  ([ready, selected]) => {
    if (!webRemote || !ready || initialOutputPromptHandled) return;
    initialOutputPromptHandled = true;
    if (!selected) outputPopoverOpen.value = true;
  },
  { immediate: true },
);

watch(
  () => status.outputSelectionRequest,
  () => {
    if (webRemote) outputPopoverOpen.value = true;
  },
);

/** 静音前的音量，用于解除静音时恢复 */
const lastVolume = ref(status.volume || 0.7);

const onVolumeWheel = (e: WheelEvent): void => {
  if (processingLocked.value) return;
  const delta = e.deltaY < 0 ? 0.05 : -0.05;
  const next = Math.max(0, Math.min(1, status.volume + delta));
  player.setVolume(next);
};

const toggleMute = (): void => {
  if (processingLocked.value) return;
  if (status.volume > 0) {
    lastVolume.value = status.volume;
    player.setVolume(0);
  } else {
    player.setVolume(lastVolume.value || 0.7);
  }
};

const toggleDesktopLyric = (): void => {
  window.api.window.toggleDesktopLyric().catch(() => {});
};

const equalizerOpen = ref(false);
const speedOpen = ref(false);
const autoCloseOpen = ref(false);
const abLoopOpen = ref(false);
const fmModeOpen = ref(false);

const moreMenuItems = computed<DropdownMenuItem[]>(() => [
  { key: "equalizer", label: t("equalizer.title"), icon: IconLucideSliders },
  { key: "speed", label: t("speed.title"), icon: IconLucideGauge },
  { key: "abLoop", label: t("abLoop.title"), icon: IconLucideRepeat2 },
  { key: "autoClose", label: t("autoClose.title"), icon: IconLucideClock },
]);

const onMoreMenuSelect = (key: string): void => {
  if (key === "equalizer") equalizerOpen.value = true;
  else if (key === "speed") speedOpen.value = true;
  else if (key === "abLoop") abLoopOpen.value = true;
  else if (key === "autoClose") autoCloseOpen.value = true;
};
</script>

<template>
  <div class="flex items-center gap-1">
    <!-- 在线音质 -->
    <QualityControl v-if="settings.appearance.showQualitySwitch" :cover="cover" />
    <!-- Web 没有系统托盘/原生菜单，直接在播放器工具栏暴露主机输出选择。 -->
    <SPopover
      v-if="webRemote"
      v-model:open="outputPopoverOpen"
      trigger="click"
      side="top"
      :cover="cover"
      content-class="w-80 px-3 py-3"
    >
      <template #trigger>
        <SButton
          :type="outputSelectionRequired ? 'primary' : buttonType"
          :variant="outputSelectionRequired ? 'tertiary' : 'ghost'"
          size="large"
          class="min-w-10 max-w-42 px-2.5"
          :class="outputSelectionRequired ? undefined : mutedClass"
          :title="`${t('settings.outputDevice.label')}: ${selectedOutputLabel}`"
        >
          <template #icon>
            <svg
              v-if="selectedOutputKind === 'diretta'"
              viewBox="0 0 24 24"
              role="img"
              aria-label="Diretta"
            >
              <path
                fill="currentColor"
                d="M4 2h7c4.5 0 7.8 2.1 9.2 5.5C17.8 5.8 15 5 11.8 5H9a2 2 0 0 0-2 2v10l-3-2V2Z"
              />
              <path
                fill="#9560D9"
                d="M17 7c2.5 1.7 4 4.1 4 7 0 5-3.8 8-9.5 8H4v-5c2 1.5 4.4 2 7.2 2 4.2 0 6.8-2.2 6.8-5.8 0-2.3-.3-4.3-1-6.2Z"
              />
            </svg>
            <component :is="selectedOutputIcon" v-else />
          </template>
          <span class="max-w-28 truncate text-sm">{{ selectedOutputLabel }}</span>
        </SButton>
      </template>
      <div class="flex flex-col gap-2">
        <div class="text-sm font-medium">{{ t("settings.outputDevice.label") }}</div>
        <div v-if="outputSelectionRequired" class="text-xs text-on-surface-variant">
          {{ t("settings.outputDevice.requiredHint") }}
        </div>
        <OutputDeviceSelector @selected="outputPopoverOpen = false" />
        <div
          v-if="settings.player.outputDevice?.startsWith('diretta:')"
          class="text-xs text-on-surface-variant"
        >
          Diretta Source Direct
        </div>
      </div>
    </SPopover>
    <SPopover trigger="hover" side="top" :cover="cover" content-class="px-3 pb-2 pt-3">
      <template #trigger>
        <SButton
          :type="buttonType"
          variant="ghost"
          circle
          size="large"
          :class="mutedClass"
          :disabled="processingLocked"
          :title="processingLocked ? processingUnavailableTitle : undefined"
          @click="toggleMute"
          @wheel.prevent="onVolumeWheel"
        >
          <template #icon>
            <IconLucideVolumeX v-if="volumePercent === 0" />
            <IconLucideVolume1 v-else-if="volumePercent < 50" />
            <IconLucideVolume2 v-else />
          </template>
        </SButton>
      </template>
      <div class="flex flex-col items-center w-7" @wheel.prevent="onVolumeWheel">
        <div class="h-30">
          <SSlider
            :model-value="status.volume"
            :min="0"
            :max="1"
            :step="0.01"
            :thumb-size="15"
            :track-height="5"
            :cover="cover"
            :disabled="processingLocked"
            vertical
            @change="player.setVolume($event)"
          />
        </div>
        <span class="text-xs tabular-nums mt-2">{{ volumePercent }}%</span>
      </div>
    </SPopover>
    <SButton
      v-if="desktopLyricAvailable"
      :type="lyricButtonType"
      :variant="isDesktopLyricOpen ? 'tertiary' : 'ghost'"
      circle
      size="large"
      :class="isDesktopLyricOpen ? undefined : mutedClass"
      @click="toggleDesktopLyric"
    >
      <template #icon><IconLucideCaptions /></template>
    </SButton>
    <!-- 私人 FM 模式调整 -->
    <SButton
      v-if="status.fmMode"
      :type="buttonType"
      :variant="fmModeOpen ? 'tertiary' : 'ghost'"
      circle
      size="large"
      :class="fmModeOpen ? undefined : mutedClass"
      :title="t('player.fm.modeTooltip')"
      @click="fmModeOpen = true"
    >
      <template #icon><IconLucideRadio /></template>
    </SButton>
    <!-- 全屏播放器内播放列表 -->
    <SButton
      v-else-if="cover"
      :type="buttonType"
      :variant="status.fullQueueOpen ? 'tertiary' : 'ghost'"
      circle
      size="large"
      :class="status.fullQueueOpen ? undefined : mutedClass"
      @click="status.fullQueueOpen = !status.fullQueueOpen"
    >
      <template #icon><IconLucideListMusic /></template>
    </SButton>
    <!-- 常规播放列表气泡 -->
    <SPopover
      v-else
      v-model:open="status.outerQueueOpen"
      trigger="click"
      side="top"
      :side-offset="12"
      content-class="!p-0 w-72 h-[min(60vh,520px)] overflow-hidden"
    >
      <template #trigger>
        <SButton
          :type="status.outerQueueOpen ? 'primary' : buttonType"
          :variant="status.outerQueueOpen ? 'tertiary' : 'ghost'"
          circle
          size="large"
          :class="status.outerQueueOpen ? undefined : mutedClass"
        >
          <template #icon><IconLucideListMusic /></template>
        </SButton>
      </template>
      <QueuePopover @close="status.outerQueueOpen = false" />
    </SPopover>
    <SDropdownMenu
      :items="moreMenuItems"
      side="top"
      align="end"
      :cover="cover"
      @select="onMoreMenuSelect"
    >
      <template #trigger>
        <SButton :type="buttonType" variant="ghost" circle size="large" :class="mutedClass">
          <template #icon><IconLucideMoreVertical /></template>
        </SButton>
      </template>
    </SDropdownMenu>
    <EqualizerDialog v-model:open="equalizerOpen" />
    <SpeedDialog v-model:open="speedOpen" />
    <AbLoopDialog v-model:open="abLoopOpen" />
    <AutoCloseDialog v-model:open="autoCloseOpen" />
    <FmModeDialog v-model:open="fmModeOpen" />
  </div>
</template>
