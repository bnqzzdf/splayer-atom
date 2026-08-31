<script setup lang="ts">
import { refreshDevices, switchDevice } from "@/core/player";
import { useStatusStore } from "@/stores/status";

const { t } = useI18n();
const status = useStatusStore();
const emit = defineEmits<{ selected: [] }>();

/**
 * Headless Web 不展示指向用户态 PipeWire 的 alsa:default，只暴露可直接打开的硬件 PCM 与 Diretta。
 */
const options = computed(() =>
  status.outputDevices.map((device) => ({
    value: device.id,
    label: device.id.startsWith("alsa:hw:") ? `ALSA · ${device.name}` : device.name,
  })),
);

const current = computed(() => status.selectedOutputDevice ?? "");

const onChange = async (value: string | number | boolean): Promise<void> => {
  await switchDevice(String(value));
  await refreshDevices();
  if (status.selectedOutputDevice === String(value)) emit("selected");
};

onMounted(() => {
  void refreshDevices();
});
</script>

<template>
  <div v-if="options.length === 0" class="rounded-lg bg-surface-variant/40 px-3 py-4 text-sm">
    {{ t("settings.outputDevice.noneAvailable") }}
  </div>
  <SSelect
    v-else
    :model-value="current"
    :options="options"
    :placeholder="t('settings.outputDevice.label')"
    @update:model-value="onChange"
  />
</template>
