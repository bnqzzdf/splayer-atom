/** 浏览器全屏控制。 */
export const useWindowControls = () => {
  const isFullscreen = ref(document.fullscreenElement !== null);

  const syncFullscreen = (): void => {
    isFullscreen.value = document.fullscreenElement !== null;
  };

  const toggleFullscreen = async (): Promise<void> => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  };

  onMounted(() => document.addEventListener("fullscreenchange", syncFullscreen));
  onBeforeUnmount(() => document.removeEventListener("fullscreenchange", syncFullscreen));

  return { isFullscreen, toggleFullscreen };
};
