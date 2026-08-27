<script setup lang="ts">
import { useDirectModeState } from "@/core/player/directMode";

const { t } = useI18n();
const { selected, blockers } = useDirectModeState();
const entryBlocked = computed(() => blockers.value.length > 0);
</script>

<template>
  <SAlert
    v-if="selected"
    :type="entryBlocked ? 'warning' : 'info'"
    :title="t('directMode.title')"
  >
    {{ t(entryBlocked ? "directMode.entryBlocked" : "directMode.processingUnavailable") }}
  </SAlert>
</template>
