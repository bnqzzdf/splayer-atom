<script setup lang="ts">
import type { Track } from "@shared/types/player";
import type { SVirtualListExposed } from "@/components/ui/SVirtualList.vue";
import { useQueuePanel } from "@/composables/useQueuePanel";

const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const listRef = shallowRef<SVirtualListExposed | null>(null);
const {
  statusStore,
  queue,
  queueLength,
  formatArtists,
  playAt,
  removeAt,
  openContainingFolder,
  clearConfirmOpen,
  clearAll,
  scrollToCurrent,
} = useQueuePanel({ listRef });

/** 点歌后关闭弹层 */
const onPlay = (index: number): void => {
  playAt(index);
  emit("close");
};

/** 清空后关闭弹层 */
const onClear = (): void => {
  clearAll();
  emit("close");
};

const onOpenContainingFolder = async (track: Track): Promise<void> => {
  if (await openContainingFolder(track)) emit("close");
};
</script>

<template>
  <div class="flex flex-col h-full">
    <div
      class="shrink-0 flex items-start justify-between gap-2 px-3 pt-3.5 pb-2.5 border-b border-b-solid border-b-on-surface/8"
    >
      <div class="flex flex-col min-w-0">
        <span class="text-sm font-semibold leading-tight truncate">{{ t("playlist.title") }}</span>
        <span class="text-xs text-on-surface-variant leading-tight mt-0.5">
          {{ t("common.totalSongs", { count: queueLength }) }}
        </span>
      </div>
      <div class="shrink-0 flex items-center gap-0.5">
        <SButton
          variant="ghost"
          circle
          size="small"
          :disabled="queueLength === 0"
          @click="scrollToCurrent"
        >
          <template #icon><IconLucideLocate /></template>
        </SButton>
        <SButton
          variant="ghost"
          circle
          size="small"
          :disabled="queueLength === 0"
          @click="clearConfirmOpen = true"
        >
          <template #icon><IconLucideTrash2 /></template>
        </SButton>
        <SButton variant="ghost" circle size="small" @click="$emit('close')">
          <template #icon><IconLucideX /></template>
        </SButton>
      </div>
    </div>
    <!-- 列表 -->
    <div v-if="queueLength > 0" class="flex-1 min-h-0 py-1">
      <SVirtualList
        ref="listRef"
        :items="queue"
        :item-height="56"
        item-fixed
        height="100%"
        :default-scroll-index="Math.max(0, statusStore.playIndex)"
        :get-item-key="(item: Track) => item.id"
      >
        <template #default="{ item, index }: { item: Track; index: number }">
          <div class="relative px-2 py-0.5">
            <div
              class="group flex items-center gap-2.5 px-2 h-13 rounded-md cursor-pointer transition-[background-color] duration-150"
              :class="
                index === statusStore.playIndex
                  ? 'bg-primary/15 text-primary'
                  : 'hover:bg-on-surface/8 active:bg-on-surface/14'
              "
              @click="onPlay(index)"
            >
              <SImg :src="item.cover" class="size-9 rounded shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="text-xs truncate font-medium leading-tight">{{ item.title }}</div>
                <div
                  class="text-[11px] truncate leading-tight mt-0.5"
                  :class="
                    index === statusStore.playIndex ? 'text-primary/70' : 'text-on-surface-variant'
                  "
                >
                  {{ formatArtists(item.artists) }}
                </div>
              </div>
              <SButton
                v-if="item.source === 'local' && (item.path || item.cuePath)"
                variant="ghost"
                circle
                size="tiny"
                :title="t('folder.openContaining')"
                class="opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                @click.stop="onOpenContainingFolder(item)"
              >
                <template #icon><IconLucideFolderOpen /></template>
              </SButton>
              <SButton
                variant="ghost"
                circle
                size="tiny"
                class="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                @click.stop="removeAt(index)"
              >
                <template #icon><IconLucideX /></template>
              </SButton>
            </div>
          </div>
        </template>
      </SVirtualList>
    </div>
    <!-- 空 -->
    <div v-else class="flex-1 flex items-center justify-center text-on-surface-variant/50">
      <div class="text-center">
        <IconLucideListMusic class="size-8 mx-auto mb-1.5 opacity-40" />
        <div class="text-xs">{{ t("playlist.empty") }}</div>
      </div>
    </div>

    <!-- 清空确认 -->
    <SDialog v-model:open="clearConfirmOpen" :title="t('playlist.clearConfirmTitle')">
      {{ t("playlist.clearConfirmContent") }}
      <template #footer="{ close }">
        <SButton variant="secondary" @click="close">
          {{ t("common.cancel") }}
        </SButton>
        <SButton type="error" variant="secondary" @click="onClear">
          {{ t("common.confirm") }}
        </SButton>
      </template>
    </SDialog>
  </div>
</template>
