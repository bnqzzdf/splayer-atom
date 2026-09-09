<script setup lang="ts">
import { downloadClient } from "@/core/downloadClient";
import CoreDirectoryPicker from "@/web/CoreDirectoryPicker.vue";
import IconLucideRotateCcw from "~icons/lucide/rotate-ccw";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();

const dir = ref("");
const corePickerOpen = ref(false);

const load = async (): Promise<void> => {
  dir.value = await downloadClient.getDir();
};

const change = async (): Promise<void> => {
  corePickerOpen.value = true;
};

const setCoreDir = async (selectedDir: string): Promise<void> => {
  dir.value = await downloadClient.setDir(selectedDir);
};

const reset = async (): Promise<void> => {
  dir.value = await downloadClient.resetDir();
};

onMounted(load);
</script>

<template>
  <div
    class="flex items-center justify-between gap-4 rounded-xl border border-solid border-outline-variant/15 bg-surface-panel px-4 py-3.5"
  >
    <div class="min-w-0 flex-1">
      <div class="text-base">{{ t("settings.downloadDir.label") }}</div>
      <div class="mt-0.5 truncate font-mono text-sm text-on-surface-variant/70" :title="dir">
        {{ dir || "—" }}
      </div>
    </div>
    <div class="shrink-0 flex items-center gap-2">
      <SButton variant="ghost" circle :title="t('common.reset')" @click="reset">
        <template #icon><IconLucideRotateCcw /></template>
      </SButton>
      <SButton variant="secondary" @click="change">
        {{ t("settings.downloadDir.change") }}
      </SButton>
    </div>

    <CoreDirectoryPicker
      v-model:open="corePickerOpen"
      :title="t('settings.downloadDir.change')"
      :initial-path="dir"
      @select="setCoreDir"
    />
  </div>
</template>
