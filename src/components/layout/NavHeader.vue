<script setup lang="ts">
import { useSettingsDialog } from "@/settings/useSettingsDialog";
import { useThemeStore } from "@/stores/theme";
import { useResponsiveLayout } from "@/composables/useResponsiveLayout";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import IconSun from "~icons/lucide/sun";
import IconMoon from "~icons/lucide/moon";
import IconMonitor from "~icons/lucide/monitor";
import IconSettings from "~icons/lucide/settings";
import IconScaling from "~icons/lucide/scaling";
import IconLucideChevronRight from "~icons/lucide/chevron-right";
import IconLucideMoreVertical from "~icons/lucide/more-vertical";
import IconLucideMenu from "~icons/lucide/menu";

const router = useRouter();
const { t } = useI18n();
const { show: showSettings } = useSettingsDialog();
const theme = useThemeStore();
const { isMobile } = useResponsiveLayout();

const toggleMobileNav = inject<() => void>("toggleMobileNav", () => {});

/** 界面缩放弹窗开关 */
const uiZoomOpen = ref(false);

const themeIcon = computed(() => {
  if (theme.mode === "light") return IconMoon;
  if (theme.mode === "dark") return IconMonitor;
  return IconSun;
});

const themeLabel = computed(() => {
  if (theme.mode === "light") return t("settings.themeMode.dark");
  if (theme.mode === "dark") return t("settings.themeMode.system");
  return t("settings.themeMode.light");
});

const menuItems = computed<DropdownMenuItem[]>(() => [
  {
    key: "theme",
    label: themeLabel.value,
    icon: themeIcon.value,
    disabled: theme.appearanceStyle === "image",
  },
  { key: "uiZoom", label: t("uiZoom.title"), icon: IconScaling },
  { key: "settings", label: t("nav.globalSettings"), icon: IconSettings, separator: true },
]);

const mobileMenuItems = computed<DropdownMenuItem[]>(() => [
  { key: "forward", label: t("nav.forward", "前进"), icon: IconLucideChevronRight },
  {
    key: "theme",
    label: themeLabel.value,
    icon: themeIcon.value,
    disabled: theme.appearanceStyle === "image",
  },
  { key: "uiZoom", label: t("uiZoom.title"), icon: IconScaling },
  { key: "settings", label: t("nav.globalSettings"), icon: IconSettings, separator: true },
]);

const onMenuSelect = (key: string): void => {
  if (key === "forward") router.forward();
  else if (key === "theme") theme.cycleMode();
  else if (key === "uiZoom") uiZoomOpen.value = true;
  else if (key === "settings") showSettings();
};
</script>

<template>
  <div class="flex items-center justify-between flex-1 h-full min-w-0">
    <!-- 手机窄屏顶栏：菜单、返回、搜索、账户、更多 -->
    <template v-if="isMobile">
      <div class="flex items-center gap-1.5 min-w-0 shrink-0">
        <SButton
          class="shrink-0"
          variant="tertiary"
          circle
          :size="38"
          :icon-size="20"
          :title="t('nav.title', '导航')"
          @click="toggleMobileNav"
        >
          <template #icon><IconLucideMenu /></template>
        </SButton>
        <SButton
          class="shrink-0"
          variant="tertiary"
          circle
          :size="38"
          :icon-size="20"
          @click="router.back()"
        >
          <template #icon><IconLucideChevronLeft /></template>
        </SButton>
      </div>

      <div class="flex-1 min-w-2" />

      <div class="flex items-center gap-1.5 shrink-0">
        <NavSearch />
        <NavUser />
        <SDropdownMenu :items="mobileMenuItems" @select="onMenuSelect">
          <template #trigger>
            <SButton class="shrink-0" variant="tertiary" circle :size="38">
              <template #icon><IconLucideMoreVertical /></template>
            </SButton>
          </template>
        </SDropdownMenu>
      </div>
    </template>

    <!-- 桌面与平板顶栏 -->
    <template v-else>
      <!-- 左侧 -->
      <div class="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
        <SButton
          class="shrink-0"
          variant="tertiary"
          circle
          :size="40"
          :icon-size="20"
          @click="router.back()"
        >
          <template #icon><IconLucideChevronLeft /></template>
        </SButton>
        <SButton
          class="shrink-0"
          variant="tertiary"
          circle
          :size="40"
          :icon-size="20"
          @click="router.forward()"
        >
          <template #icon><IconLucideChevronRight /></template>
        </SButton>
        <NavSearch />
      </div>
      <!-- 中间 -->
      <div class="flex-1 h-full min-w-4" />
      <!-- 右侧 -->
      <div class="flex items-center gap-2 sm:gap-3 shrink-0">
        <NavUser />
        <SDropdownMenu :items="menuItems" @select="onMenuSelect">
          <template #trigger>
            <SButton class="shrink-0" variant="tertiary" circle :size="40">
              <template #icon><IconLucideSettings /></template>
            </SButton>
          </template>
        </SDropdownMenu>
      </div>
    </template>
    <UiZoomDialog v-model:open="uiZoomOpen" />
  </div>
</template>
