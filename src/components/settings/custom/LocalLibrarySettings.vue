<script setup lang="ts">
import { useLibraryStore } from "@/stores/library";
import FolderManager from "@/components/library/FolderManager.vue";

const { t } = useI18n();
const libraryStore = useLibraryStore();
const { scanDirs, scanning, scanProgress, initialized } = storeToRefs(libraryStore);

const scanPercent = computed(() => {
  if (!scanProgress.value?.total) return 0;
  return Math.min(100, Math.round((scanProgress.value.scanned / scanProgress.value.total) * 100));
});

onMounted(async () => {
  if (!initialized.value) await libraryStore.load();
});
</script>

<template>
  <div class="flex flex-col gap-8">
    <section class="flex flex-col gap-3">
      <div>
        <h3 class="text-lg font-semibold text-on-surface">{{ t("library.musicDirectories") }}</h3>
        <p class="mt-1 text-sm text-on-surface-variant/60">
          {{ t("library.musicDirectoriesDescription") }}
        </p>
      </div>
      <FolderManager />
    </section>

    <section class="flex flex-col gap-3">
      <div>
        <h3 class="text-lg font-semibold text-on-surface">{{ t("library.scanLibrary") }}</h3>
        <p class="mt-1 text-sm text-on-surface-variant/60">
          {{ t("library.scanLibraryDescription") }}
        </p>
      </div>

      <div class="flex items-center gap-2">
        <SButton
          type="primary"
          variant="secondary"
          :disabled="scanDirs.length === 0 || scanning"
          @click="libraryStore.startScan(true)"
        >
          <template #icon><IconLucideRefreshCw /></template>
          {{ t("library.scanIncremental") }}
        </SButton>
        <SButton
          variant="secondary"
          :disabled="scanDirs.length === 0 || scanning"
          @click="libraryStore.startScan(false)"
        >
          {{ t("library.scanAll") }}
        </SButton>
        <SButton
          v-if="scanning"
          type="error"
          variant="secondary"
          @click="libraryStore.cancelScan()"
        >
          {{ t("library.cancelScan") }}
        </SButton>
      </div>

      <div
        v-if="scanning && scanProgress"
        class="flex items-center gap-2 rounded-lg bg-on-surface/4 px-3 py-2 text-sm text-on-surface-variant/70"
      >
        <SLoading class="size-3.5 shrink-0 text-primary" />
        <span class="tabular-nums">
          {{
            t("library.scanProgress", { scanned: scanProgress.scanned, total: scanProgress.total })
          }}
        </span>
        <span class="font-mono text-on-surface-variant/45">{{ scanPercent }}%</span>
      </div>
      <p v-else class="text-xs text-on-surface-variant/50">{{ t("library.scanIdleHint") }}</p>
    </section>
  </div>
</template>
