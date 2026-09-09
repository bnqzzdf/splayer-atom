<script setup lang="ts">
import { useDirectModeState } from "@/core/player/directMode";

const { t } = useI18n();
const { selected, remoteSelected, blockers } = useDirectModeState();
const entryBlocked = computed(() => selected.value && blockers.value.length > 0);
const visible = computed(() => selected.value || remoteSelected.value);
const titleKey = computed(() => (remoteSelected.value ? "remoteOutput.title" : "directMode.title"));
const messageKey = computed(() => {
  if (remoteSelected.value) return "remoteOutput.processingUnavailable";
  return entryBlocked.value ? "directMode.entryBlocked" : "directMode.processingUnavailable";
});
</script>

<template>
  <SAlert v-if="visible" :type="entryBlocked ? 'warning' : 'info'" :title="t(titleKey)">
    {{ t(messageKey) }}
  </SAlert>
</template>
