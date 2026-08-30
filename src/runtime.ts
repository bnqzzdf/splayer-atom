/** Renderer 运行形态。 */
export type RendererRuntime = "desktop" | "web";

/** Control 所在主机提供、且不属于 Core Domain 的本地能力。 */
export type ControlHostCapability =
  | "windowControls"
  | "desktopLyric"
  | "globalHotkeys"
  | "tray"
  | "nativeFileDialogs"
  | "protocolHandler"
  | "desktopUpdater"
  | "hostLogDirectory"
  | "hostFileExplorer"
  | "hostFileSave"
  | "providerLoginWindow"
  | "systemFonts"
  | "musicRecognition"
  | "cloudUpload"
  | "nativeCjkTransform"
  | "browserClipboard"
  | "browserDownload"
  | "browserNotification";

const desktopHostCapabilities = new Set<ControlHostCapability>([
  "windowControls",
  "desktopLyric",
  "globalHotkeys",
  "tray",
  "nativeFileDialogs",
  "protocolHandler",
  "desktopUpdater",
  "hostLogDirectory",
  "hostFileExplorer",
  "hostFileSave",
  "providerLoginWindow",
  "systemFonts",
  "musicRecognition",
  "cloudUpload",
  "nativeCjkTransform",
]);
const webHostCapabilities = new Set<ControlHostCapability>([
  "browserClipboard",
  "browserDownload",
  "browserNotification",
]);

/** 当前 renderer 是否由远端浏览器运行。 */
export const isWebRemote = (): boolean => document.documentElement.dataset.atomRuntime === "web";

/** 当前 renderer 是否运行在 Electron preload 环境。 */
export const isDesktopRenderer = (): boolean => !isWebRemote();

/**
 * 判断当前 Control 主机是否提供指定本地能力。
 * @param capability - Host capability 标识
 * @returns 当前 Control 是否可使用该能力
 */
export const hasHostCapability = (capability: ControlHostCapability): boolean =>
  (isDesktopRenderer() ? desktopHostCapabilities : webHostCapabilities).has(capability);
