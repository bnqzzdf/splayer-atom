<script setup lang="ts">
import type { AudioDevice } from "@shared/types/player";
import { refreshDevices, switchDevice } from "@/core/player";
import {
  getOutputDisplayName,
  getOutputKind,
  getOutputPathIndex,
  type OutputKind,
} from "@/core/outputDevices";
import { useStatusStore } from "@/stores/status";
import AlsaPlaybackModeSelector from "@/components/settings/custom/AlsaPlaybackModeSelector.vue";
import IconLucideCheck from "~icons/lucide/check";
import IconLucideRefreshCw from "~icons/lucide/refresh-cw";

const { t } = useI18n();
const status = useStatusStore();
const emit = defineEmits<{ selected: [] }>();

const refreshing = ref(false);
const selectingId = ref<string | null>(null);

interface OutputGroup {
  kind: OutputKind;
  label: string;
  devices: AudioDevice[];
  refreshable: boolean;
}

/** 快捷输出菜单直接展示分类后的 Core snapshot，不再在 Popover 内嵌第二层 Select。 */
const groups = computed<OutputGroup[]>(() => {
  const byKind: Record<OutputKind, AudioDevice[]> = { alsa: [], diretta: [], upnp: [] };
  for (const device of status.outputDevices) {
    const kind = getOutputKind(device.id);
    if (kind) byKind[kind].push(device);
  }
  const allGroups: OutputGroup[] = [
    {
      kind: "alsa",
      label: t("settings.outputDevice.groups.alsa"),
      devices: byKind.alsa,
      refreshable: false,
    },
    {
      kind: "diretta",
      label: t("settings.outputDevice.groups.diretta"),
      devices: byKind.diretta,
      refreshable: true,
    },
    {
      kind: "upnp",
      label: t("settings.outputDevice.groups.upnp"),
      devices: byKind.upnp,
      refreshable: true,
    },
  ];
  return allGroups.filter((group) => group.kind !== "diretta" || group.devices.length > 0);
});

const outputLabel = (device: AudioDevice, devices: AudioDevice[]): string => {
  const name = getOutputDisplayName(device);
  const pathIndex = getOutputPathIndex(device, devices);
  return pathIndex === null
    ? name
    : `${name} (${t("settings.outputDevice.networkPath", { index: pathIndex })})`;
};

const refreshDiscovery = async (): Promise<void> => {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    // /output/devices 每次都会重新执行 Diretta 与 UPnP discovery，并同时刷新 ALSA snapshot。
    await refreshDevices();
  } finally {
    refreshing.value = false;
  }
};

const onSelect = async (deviceId: string): Promise<void> => {
  if (selectingId.value) return;
  selectingId.value = deviceId;
  try {
    await switchDevice(deviceId);
    if (status.selectedOutputDevice === deviceId) emit("selected");
  } finally {
    selectingId.value = null;
  }
};

onMounted(() => {
  // 初始化尚未完成时补做一次加载；已有快照时打开面板不再重复扫描。
  if (!status.outputDevicesReady) void refreshDiscovery();
});
</script>

<template>
  <div class="max-h-80 overflow-y-auto -mx-1 px-1">
    <section v-for="group in groups" :key="group.kind" class="mb-3 last:mb-0">
      <div class="mb-1 flex h-7 items-center justify-between px-1.5">
        <span class="text-xs font-medium text-on-surface-variant">{{ group.label }}</span>
        <SButton
          v-if="group.refreshable"
          type="default"
          variant="ghost"
          circle
          size="tiny"
          :disabled="refreshing"
          :title="t('settings.outputDevice.refresh')"
          @click="refreshDiscovery"
        >
          <template #icon>
            <IconLucideRefreshCw class="size-3.5" :class="{ 'animate-spin': refreshing }" />
          </template>
        </SButton>
      </div>

      <div v-if="group.devices.length > 0" class="flex flex-col gap-0.5">
        <button
          v-for="device in group.devices"
          :key="device.id"
          type="button"
          class="relative flex min-h-10 w-full items-center rounded-lg px-2.5 pr-9 text-left text-sm transition-colors border-0 outline-none appearance-none disabled:cursor-wait disabled:opacity-60"
          :class="
            device.id === status.selectedOutputDevice
              ? 'bg-primary/15 text-primary font-medium'
              : 'bg-transparent text-on-surface hover:bg-on-surface/8'
          "
          :disabled="selectingId !== null"
          :title="outputLabel(device, group.devices)"
          @click="onSelect(device.id)"
        >
          <span class="truncate">{{ outputLabel(device, group.devices) }}</span>
          <IconLucideCheck
            v-if="device.id === status.selectedOutputDevice"
            class="absolute right-2.5 size-4 shrink-0 text-primary"
          />
        </button>
      </div>
      <div v-else class="px-2.5 py-1.5 text-xs text-on-surface-variant/65">
        {{ t("settings.outputDevice.noneInGroup") }}
      </div>
      <div
        v-if="group.kind === 'alsa' && status.selectedOutputDevice?.startsWith('alsa:hw:')"
        class="mt-1.5 flex items-center gap-2 px-2.5 py-1"
      >
        <span class="shrink-0 text-xs text-on-surface-variant">
          {{ t("settings.alsaPlaybackMode.shortLabel") }}
        </span>
        <div class="min-w-0 flex-1">
          <AlsaPlaybackModeSelector />
        </div>
      </div>
    </section>
  </div>
</template>
