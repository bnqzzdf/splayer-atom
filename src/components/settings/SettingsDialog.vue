<script setup lang="ts">
import { useSettingsDialog } from "@/settings/useSettingsDialog";
import { useResponsiveLayout } from "@/composables/useResponsiveLayout";

const dialog = useSettingsDialog();
const { open } = dialog;
const { isMobile } = useResponsiveLayout();
</script>

<template>
  <SDialog
    v-model:open="open"
    :width="isMobile ? 'calc(100vw - 16px)' : 'min(1024px, calc(100vw - 40px))'"
    :height="isMobile ? 'calc(100dvh - 16px)' : '75vh'"
    destroy-on-close
  >
    <SettingsContent class="h-full" />
  </SDialog>
</template>
