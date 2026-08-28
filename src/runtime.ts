/** Renderer 运行形态。 */
export type RendererRuntime = "desktop" | "web";

/** 当前 renderer 是否由远端浏览器运行。 */
export const isWebRemote = (): boolean => document.documentElement.dataset.atomRuntime === "web";

/** 当前 renderer 是否运行在 Electron preload 环境。 */
export const isDesktopRenderer = (): boolean => !isWebRemote();
