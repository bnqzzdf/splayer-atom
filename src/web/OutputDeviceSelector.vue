<script setup lang="ts">
import type { AudioDevice } from "@shared/types/player";
import { refreshDevices, switchDevice } from "@/core/player";
import { getOutputDisplayName, getOutputKind, type OutputKind } from "@/core/outputDevices";
import { useStatusStore } from "@/stores/status";
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
  void refreshDiscovery();
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
          class="relative flex min-h-9 w-full items-center rounded-lg px-2.5 pr-9 text-left text-sm transition-colors hover:bg-on-surface/8 disabled:cursor-wait disabled:opacity-60"
          :class="device.id === status.selectedOutputDevice ? 'text-primary' : 'text-on-surface'"
          :disabled="selectingId !== null"
          :title="getOutputDisplayName(device)"
          @click="onSelect(device.id)"
        >
          <span class="truncate">{{ getOutputDisplayName(device) }}</span>
          <IconLucideCheck
            v-if="device.id === status.selectedOutputDevice"
            class="absolute right-2.5 size-4 shrink-0 text-primary"
          />
        </button>
      </div>
      <div v-else class="px-2.5 py-1.5 text-xs text-on-surface-variant/65">
        {{ t("settings.outputDevice.noneInGroup") }}
      </div>
    </section>
  </div>
</template>
