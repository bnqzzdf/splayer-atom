<script setup lang="ts">
import { useDirectModeState } from "@/core/player/directMode";

const { t } = useI18n();
const { selected, alsaDirectSelected, remoteSelected } = useDirectModeState();
const visible = computed(() => selected.value || remoteSelected.value);
const titleKey = computed(() => {
  if (remoteSelected.value) return "remoteOutput.title";
  if (alsaDirectSelected.value) return "directMode.alsaTitle";
  return "directMode.title";
});
const messageKey = computed(() => {
  if (remoteSelected.value) return "remoteOutput.processingUnavailable";
  if (alsaDirectSelected.value) return "directMode.alsaProcessingUnavailable";
  return "directMode.processingUnavailable";
});
</script>

<template>
  <SAlert v-if="visible" type="info" :title="t(titleKey)">
    {{ t(messageKey) }}
  </SAlert>
</template>
