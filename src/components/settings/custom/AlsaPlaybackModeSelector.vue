<script setup lang="ts">
import type { AlsaPlaybackMode } from "@shared/types/settings";
import { switchAlsaPlaybackMode } from "@/core/player";
import { useSettingsStore } from "@/stores/settings";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    /** 落在封面玻璃弹层（暗底）上时改用封面色 */
    cover?: boolean;
  }>(),
  { cover: false },
);

const { t } = useI18n();
const settings = useSettingsStore();
const switching = ref(false);

const options = computed(() => [
  { value: "direct", label: t("settings.alsaPlaybackMode.direct") },
  { value: "processed", label: t("settings.alsaPlaybackMode.processed") },
]);

const onChange = async (value: string | number | boolean): Promise<void> => {
  if (switching.value) return;
  const mode = String(value) as AlsaPlaybackMode;
  if (mode !== "direct" && mode !== "processed") return;
  switching.value = true;
  try {
    await switchAlsaPlaybackMode(mode);
  } finally {
    switching.value = false;
  }
};
</script>

<template>
  <SSelect
    :model-value="settings.system.player.alsaPlaybackMode"
    :options="options"
    :disabled="switching"
    :cover="props.cover"
    @update:model-value="onChange"
  />
</template>
