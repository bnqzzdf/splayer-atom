<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { refreshDevices, switchDevice } from "@/core/player";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const status = useStatusStore();
const settings = useSettingsStore();

const current = computed(() => settings.player.outputDevice ?? "");

const options = computed(() => {
  return status.outputDevices.map((device) => ({ value: device.id, label: device.name }));
});

const onChange = (value: string | number | boolean) => {
  const deviceId = String(value);
  if (deviceId) void switchDevice(deviceId);
};

onMounted(() => {
  if (status.outputDevices.length === 0) refreshDevices();
});
</script>

<template>
  <SSelect
    :model-value="current"
    :options="options"
    :placeholder="t('settings.outputDevice.required')"
    @update:model-value="onChange"
  />
</template>
