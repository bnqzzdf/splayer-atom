import { useMediaQuery } from "@vueuse/core";

/**
 * Web Control 响应式断点判断
 * 依据 docs/web-responsive-plan.md 统一使用 768px / 1280px 断点：
 * - 手机: < 768px
 * - 平板: 768px ~ 1279px
 * - 桌面: >= 1280px
 */
export const useResponsiveLayout = () => {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const isTablet = useMediaQuery("(min-width: 768px) and (max-width: 1279px)");
  const isDesktop = useMediaQuery("(min-width: 1280px)");
  /** 窄屏（手机或平板，宽度小于 1280px） */
  const isCompact = useMediaQuery("(max-width: 1279px)");

  return {
    isMobile,
    isTablet,
    isDesktop,
    isCompact,
  };
};
