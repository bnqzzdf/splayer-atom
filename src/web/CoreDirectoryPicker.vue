<script setup lang="ts">
import type { CoreDirectoryListing } from "@shared/types/coreFilesystem";
import { request } from "@/web/client";
import IconLucideArrowUp from "~icons/lucide/arrow-up";
import IconLucideFolder from "~icons/lucide/folder";

const props = defineProps<{
  open: boolean;
  title: string;
  initialPath?: string;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "select", dir: string): void;
}>();

const { t } = useI18n();
const listing = ref<CoreDirectoryListing | null>(null);
const pathInput = ref("");
const loading = ref(false);
const error = ref("");

const load = async (dir?: string): Promise<boolean> => {
  if (loading.value) return false;
  loading.value = true;
  error.value = "";
  try {
    const query = dir?.trim() ? `?path=${encodeURIComponent(dir.trim())}` : "";
    listing.value = await request<CoreDirectoryListing>(`/filesystem/directories${query}`);
    pathInput.value = listing.value.path;
    return true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    return false;
  } finally {
    loading.value = false;
  }
};

const loadInitial = async (): Promise<void> => {
  if (!props.initialPath || (await load(props.initialPath))) return;
  await load();
};

const selectCurrent = (): void => {
  if (!listing.value) return;
  emit("select", listing.value.path);
  emit("update:open", false);
};

watch(
  () => props.open,
  (open) => {
    if (open) void loadInitial();
  },
);
</script>

<template>
  <SDialog
    :open="open"
    :title="title"
    width="620px"
    @update:open="(value) => emit('update:open', value)"
  >
    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <SButton
          variant="secondary"
          circle
          :disabled="!listing?.parent || loading"
          :title="t('coreDirectory.parent')"
          @click="listing?.parent && load(listing.parent)"
        >
          <template #icon><IconLucideArrowUp /></template>
        </SButton>
        <SInput
          v-model="pathInput"
          class="min-w-0 flex-1 font-mono"
          :placeholder="t('coreDirectory.pathPlaceholder')"
          :disabled="loading"
          @keyup.enter="load(pathInput)"
        />
        <SButton variant="secondary" :loading="loading" @click="load(pathInput)">
          {{ t("coreDirectory.open") }}
        </SButton>
      </div>

      <div
        class="min-h-56 max-h-80 overflow-y-auto rounded-xl border border-solid border-outline-variant/20 bg-surface-panel p-1"
      >
        <button
          v-for="entry in listing?.directories ?? []"
          :key="entry.path"
          type="button"
          class="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-on-surface/6"
          @click="load(entry.path)"
        >
          <IconLucideFolder class="size-4 shrink-0 text-on-surface-variant" />
          <span class="min-w-0 flex-1 truncate">{{ entry.name }}</span>
        </button>
        <div
          v-if="!loading && (listing?.directories.length ?? 0) === 0"
          class="py-10 text-center text-sm text-on-surface-variant/60"
        >
          {{ t("coreDirectory.empty") }}
        </div>
      </div>

      <div v-if="error" class="text-sm text-error break-all">{{ error }}</div>
      <div class="text-xs text-on-surface-variant/60 break-all">
        {{ t("coreDirectory.current") }}: {{ listing?.path ?? "—" }}
      </div>
    </div>

    <template #footer="{ close }">
      <SButton variant="secondary" @click="close">{{ t("common.cancel") }}</SButton>
      <SButton type="primary" :disabled="!listing || loading" @click="selectCurrent">
        {{ t("coreDirectory.selectCurrent") }}
      </SButton>
    </template>
  </SDialog>
</template>
