<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { useResponsiveLayout } from "@/composables/useResponsiveLayout";

const route = useRoute();
const { t } = useI18n();
const status = useStatusStore();
const settings = useSettingsStore();
const { isMobile, isDesktop } = useResponsiveLayout();

/** Web Control 常驻播放栏以保留首次输出选择入口。 */
const showPlayerBar = computed(() => true);
const { isPlayerExpanded } = storeToRefs(status);
const { appearance } = settings;

/** 移动端侧栏导航抽屉状态与切换方法 */
const mobileNavOpen = ref(false);
provide("mobileNavOpen", mobileNavOpen);
provide("toggleMobileNav", () => {
  mobileNavOpen.value = !mobileNavOpen.value;
});

/** 路由切换动效 */
const routeTransitionName = computed(() => {
  const transition = appearance.routeTransition;
  return transition === "none" ? "" : `route-${transition}`;
});

/** 路由 key */
const routeKey = computed(() => {
  const hasParam = route.matched.some((m) => m.path.includes(":"));
  return hasParam ? route.path : (route.matched[1]?.path ?? route.path);
});

/** 需要受控缓存的页面组件白名单 */
const cachedViews = [
  "Home",
  "Songs",
  "Liked",
  "History",
  "Download",
  "Daily",
  "Favorites",
  "Cloud",
  "LocalList",
  "Folders",
  "SearchPage",
  "Stats",
  "StreamingIndex",
];

const mainContainerRef = shallowRef<HTMLElement | null>(null);
const mainScrollMap = new Map<string, number>();

// 路由离开前记录滚动位置
watch(
  () => route.fullPath,
  (_newPath, oldPath) => {
    if (oldPath && mainContainerRef.value) {
      mainScrollMap.set(oldPath, mainContainerRef.value.scrollTop);
    }
  },
);

// 路由切换完成后恢复滚动位置
const handleAfterEnter = (): void => {
  if (!mainContainerRef.value) return;
  const saved = mainScrollMap.get(route.fullPath) ?? 0;
  mainContainerRef.value.scrollTop = saved;
};

/** 侧边栏样式 */
const sidebarClass = computed(() => {
  const classes: string[] = [];
  if (appearance.layoutMode === "floating" && isDesktop.value) {
    classes.push("ml-3 mt-3 mb-3 rounded-xl border border-solid border-primary/10");
  } else {
    classes.push("border-r border-r-solid border-r-primary/10");
    if (showPlayerBar.value && appearance.layoutMode === "default" && isDesktop.value) {
      classes.push("mb-20");
    }
  }
  return classes.join(" ");
});

/** 主界面底部边距（仅宽屏非浮动模式预留 fixed 底栏高度；窄屏处于正常文档流） */
const mainMarginClass = computed(() => {
  if (!isDesktop.value) return "";
  return showPlayerBar.value && appearance.layoutMode !== "floating" ? "mb-20" : "";
});

/** 外层播放条样式（宽屏专用 fixed 定位） */
const playerBarWrapperClass = computed(() => {
  const base = "fixed bottom-0 z-50 transition-[left] duration-300 pointer-events-none";
  const collapsed = appearance.sidebarCollapsed;
  switch (appearance.layoutMode) {
    case "sidebar-full":
      return `${base} ${collapsed ? "left-16" : "left-60"} right-0`;
    case "floating":
      return `${base} ${collapsed ? "left-[76px]" : "left-[252px]"} right-0 px-4 pb-6`;
    default:
      return `${base} left-0 right-0`;
  }
});

/** 内层播放条样式（宽屏专用） */
const playerBarInnerClass = computed(() => {
  const base = isPlayerExpanded.value ? "pointer-events-none" : "pointer-events-auto";
  switch (appearance.layoutMode) {
    case "floating":
      return `${base} mx-auto max-w-4xl glass-panel rounded-full shadow-xl border border-solid border-primary/10`;
    default:
      return `${base} h-20 bg-surface-panel border-t border-t-solid border-t-primary/10`;
  }
});
</script>

<template>
  <!-- 主界面：支持 svh、dvh 与 safe area -->
  <div
    class="h-full h-screen h-[100svh] h-[100dvh] flex overflow-hidden bg-app text-on-surface transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.7,0,0.3,1)] origin-center"
    :class="isPlayerExpanded ? 'scale-95 opacity-0 pointer-events-none' : ''"
  >
    <!-- 侧边栏：手机隐藏，平板与桌面常驻 -->
    <aside
      v-if="!isMobile"
      class="shrink-0 bg-surface-panel overflow-y-auto z-10 transition-[width,margin] duration-300"
      :class="[appearance.sidebarCollapsed ? 'w-16' : 'w-60', sidebarClass]"
    >
      <SideBar />
    </aside>

    <!-- 右侧主区域（窄屏下包含正常流 Header、独立滚动 Main 与常驻 Footer） -->
    <div class="flex-1 flex flex-col min-w-0 min-h-0" :class="mainMarginClass">
      <!-- 顶部导航 -->
      <header
        class="shrink-0 flex items-center px-3"
        :class="isMobile ? 'h-14 border-b border-b-solid border-b-primary/10' : 'h-16'"
      >
        <NavHeader />
      </header>

      <!-- 主内容区：独立滚动，窄屏预留固定底栏高度 -->
      <main
        ref="mainContainerRef"
        class="flex-1 overflow-y-auto overflow-x-hidden min-h-0 min-w-0"
        :class="!isDesktop && showPlayerBar ? 'pb-16' : ''"
      >
        <RouterView v-slot="{ Component }">
          <Transition :name="routeTransitionName" mode="out-in" @after-enter="handleAfterEnter">
            <KeepAlive :max="10" :include="cachedViews">
              <component :is="Component" :key="routeKey" />
            </KeepAlive>
          </Transition>
        </RouterView>
      </main>

      <!-- 窄屏/移动端固定底部播放栏（强制贴合当前可视区底端，避免被移动浏览器自带底栏遮挡） -->
      <footer
        v-if="!isDesktop && showPlayerBar"
        class="fixed bottom-0 left-0 right-0 z-30 bg-surface-panel border-t border-t-solid border-t-primary/10 pb-[env(safe-area-inset-bottom,0px)]"
        :class="isPlayerExpanded ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100'"
      >
        <PlayerBar />
      </footer>
    </div>
  </div>

  <!-- 桌面固定/悬浮播放栏（仅 >=1280px 生效，保留三种桌面布局模式） -->
  <Transition
    enter-active-class="transition-transform duration-300 ease-out"
    leave-active-class="transition-transform duration-300 ease-in"
    enter-from-class="translate-y-full"
    leave-to-class="translate-y-full"
  >
    <div v-if="isDesktop && showPlayerBar" :class="playerBarWrapperClass">
      <footer :class="playerBarInnerClass">
        <PlayerBar />
      </footer>
    </div>
  </Transition>

  <!-- 手机导航抽屉 -->
  <SDrawer
    v-model:open="mobileNavOpen"
    side="left"
    width="min(320px, calc(100vw - 24px))"
    :title="t('nav.title', '导航')"
    closable
  >
    <SideBar in-drawer @close="mobileNavOpen = false" />
  </SDrawer>

  <!-- Toast -->
  <SToast :max="1" />
  <!-- Dialog -->
  <SDialogProvider />
  <!-- 全屏播放器 -->
  <FullPlayer />
  <!-- 全局设置 -->
  <SettingsDialog />
  <!-- 评论弹窗 -->
  <MusicCommentsDialog />
</template>
