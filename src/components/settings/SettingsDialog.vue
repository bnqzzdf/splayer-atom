<script setup lang="ts">
import { useSettingsDialog } from "@/settings/useSettingsDialog";

const dialog = useSettingsDialog();
const { open } = dialog;
</script>

<template>
  <SDialog
    v-model:open="open"
    width="min(1024px, calc(100vw - 40px))"
    height="75vh"
    destroy-on-close
  >
    <SettingsContent class="h-full" />
  </SDialog>
</template>
