<script setup lang="ts">
import { settingsSchema } from "@/settings/schema";
import { useSettingsDialog } from "@/settings/useSettingsDialog";
import { useSettingsStore } from "@/stores/settings";
import { useResponsiveLayout } from "@/composables/useResponsiveLayout";
import { openExternal } from "@/utils/url";
import { REPO_URL, REPO_NAME, APP_VERSION } from "@/utils/config";
import IconLucideArrowLeft from "~icons/lucide/arrow-left";

const { initialCategory, initialHighlight, rememberCategory } = useSettingsDialog();

// 同步后端配置
useSettingsStore().syncSystem();
const { t } = useI18n();
const { isMobile } = useResponsiveLayout();

const activeId = ref(initialCategory.value);
const highlightKey = ref(initialHighlight.value);
const scrollRef = ref<HTMLElement>();
const isSearchActive = ref(false);

/** 移动端视图状态：分类菜单 vs 详情内容 */
const mobileView = ref<"menu" | "content">(
  initialHighlight.value || (initialCategory.value && initialCategory.value !== "general")
    ? "content"
    : "menu",
);

const activeCategory = computed(() => settingsSchema.find((c) => c.id === activeId.value));

/** 计算每个 section 的全局起始索引 */
const sectionStartIndices = computed(() => {
  const indices: number[] = [];
  let idx = 0;
  for (const sec of activeCategory.value?.sections ?? []) {
    indices.push(idx);
    idx += 1 + sec.items.length;
  }
  return indices;
});

const onCategorySelect = (id: string) => {
  activeId.value = id;
  highlightKey.value = undefined;
  rememberCategory(id);
  if (isMobile.value) mobileView.value = "content";
  nextTick(() => scrollRef.value?.scrollTo({ top: 0 }));
};

const onSearchSelect = (categoryId: string, itemKey: string) => {
  highlightKey.value = itemKey;
  if (activeId.value !== categoryId) {
    activeId.value = categoryId;
  }
  if (isMobile.value) mobileView.value = "content";
  nextTick(() => {
    setTimeout(() => {
      const el = document.getElementById(`setting-${itemKey}`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      setTimeout(() => {
        highlightKey.value = undefined;
      }, 2500);
    }, 100);
  });
};

onMounted(() => {
  if (initialHighlight.value) {
    onSearchSelect(initialCategory.value, initialHighlight.value);
  }
});
</script>

<template>
  <div class="flex h-full overflow-hidden">
    <!-- 左侧菜单：桌面端始终显示，移动端在 menu 视图时全宽显示 -->
    <div
      v-show="!isMobile || mobileView === 'menu'"
      class="flex flex-col bg-surface-panel p-4 sm:p-5"
      :class="isMobile ? 'w-full flex-1' : 'w-70 shrink-0'"
    >
      <h2 class="text-2xl font-bold mb-1 px-1">{{ t("settings.title") }}</h2>
      <p class="text-sm text-on-surface-variant/80 mb-4 sm:mb-5 px-1">
        {{ t("settings.subtitle") }}
      </p>

      <!-- 搜索 -->
      <SettingsSearch
        class="mb-4"
        @select="onSearchSelect"
        @active-change="isSearchActive = $event"
      />

      <!-- 菜单 -->
      <Transition name="fade">
        <div
          v-show="!isSearchActive"
          class="flex-1 min-h-0 overflow-y-auto -mr-4 sm:-mr-5 pr-4 sm:pr-5"
        >
          <SettingsMenu
            :categories="settingsSchema"
            :active-id="activeId"
            @select="onCategorySelect"
          />
        </div>
      </Transition>

      <!-- 底部 -->
      <div class="shrink-0 mt-auto pt-4 px-1 flex items-center gap-1">
        <SButton variant="text" size="tiny" @click="openExternal(REPO_URL)">
          <template #icon><IconLucideGithub /></template>
          {{ REPO_NAME }}
        </SButton>
        <STag size="tiny">v{{ APP_VERSION }}</STag>
      </div>
    </div>

    <!-- 右侧内容：桌面端始终显示，移动端在 content 视图时全宽显示 -->
    <div
      v-show="!isMobile || mobileView === 'content'"
      ref="scrollRef"
      class="flex-1 overflow-y-auto bg-surface py-4 px-4 sm:py-6 sm:px-8"
    >
      <!-- 移动端返回分类列表头部 -->
      <div v-if="isMobile" class="mb-4 flex items-center gap-2">
        <SButton variant="ghost" size="small" @click="mobileView = 'menu'">
          <template #icon><IconLucideArrowLeft class="size-4" /></template>
          <span>{{ t("common.back") }}</span>
        </SButton>
        <span class="font-bold text-base text-on-surface truncate">
          {{ activeCategory ? t(`settings.group.${activeCategory.id}`) : "" }}
        </span>
      </div>

      <div v-if="activeCategory" :key="activeCategory.id" class="animate-fade-in">
        <component :is="activeCategory.component" v-if="activeCategory.component" />
        <template v-else>
          <SettingsSection
            v-for="(sec, si) in activeCategory.sections"
            :key="sec.id"
            :section="sec"
            :highlight-key="highlightKey"
            :start-index="sectionStartIndices[si] ?? 0"
          />
        </template>
      </div>
    </div>
  </div>
</template>
