import { useSettingsStore } from "@/stores/settings";
import { useMediaStore } from "@/stores/media";
import { useResponsiveLayout } from "@/composables/useResponsiveLayout";

/** 悬浮播放栏底部留白 */
const PLAYER_BAR_GAP = 112;

/**
 * 悬浮播放栏状态
 * 窄屏（<1280px）停用浮动栏及底部留白补偿；仅在宽屏（>=1280px）且设置项为 floating 时生效。
 */
export const useFloatingPlayerBar = () => {
  const settings = useSettingsStore();
  const media = useMediaStore();
  const { isDesktop } = useResponsiveLayout();

  /** 是否处于悬浮播放栏（仅宽屏生效） */
  const isFloatingBar = computed(
    () => isDesktop.value && settings.appearance.layoutMode === "floating" && !!media.track,
  );

  return { isFloatingBar, PLAYER_BAR_GAP };
};
