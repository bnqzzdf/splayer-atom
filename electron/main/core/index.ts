import { app, BrowserWindow } from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import {
  createMainWindow,
  restoreLyricWindows,
  getMainWindow,
  focusMainWindow,
  getDesktopLyricWindow,
  getDynamicIslandWindow,
  getTaskbarLyricWindow,
} from "@main/window";
import { isMac } from "@main/utils/config";
import { registerIpcHandlers } from "@main/ipc";
import { init as initMedia, shutdown as shutdownMedia } from "@main/services/media";
import { init as initLastfm } from "@main/services/lastfm";
import { registerDesktopPlaybackPresentation } from "@main/atom/desktop/playbackPresentation";
import { initGlobalHotkey } from "@main/services/globalHotkey";
import { initDatabase, closeDatabase } from "@main/database";
import { init as initSongCache, shutdown as shutdownSongCache } from "@main/services/songCache";
import { init as initDownload, shutdown as shutdownDownload } from "@main/services/downloadManager";
import { shutdownCorePlayStats } from "@main/services/headlessPlayStats";
import { initListenBrainz, shutdownListenBrainz } from "@main/services/listenbrainz";
import { pluginRegistry } from "@main/plugins/registry";
import { isHeadless } from "./mode";
import {
  registerPluginControlEvents,
  unregisterPluginControlEvents,
} from "@main/services/pluginControl";
import {
  init as initPlaybackBridge,
  dispose as disposePlaybackBridge,
} from "@main/plugins/playbackBridge";
import { registerCacheScheme, handleCacheProtocol, MAIN_PARTITION } from "@main/utils/protocol";
import {
  handleCoreControlProtocolOnPartition,
  registerCoreControlScheme,
} from "@main/atom/controlProtocol";
import { startServer, stopServer } from "@main/server";
import { initPlaybackSession, shutdownPlaybackSession } from "@main/services/playbackSession";
import { startMcpServer, stopMcpServer } from "@main/services/mcp/http";
import { initUpdater, disposeUpdater } from "@main/services/updater";
import { coreLog, initLogger } from "@main/utils/logger";
import { store } from "@main/store";
import { configureDesktopEventSink } from "@main/atom/runtime/events";
import { sendToMain } from "@main/utils/broadcast";
import {
  initOrpheusRegistration,
  extractOrpheusUrl,
  captureOrpheusUrl,
} from "@main/services/orpheus";
import { extractAudioFiles, captureAudioFiles } from "@main/services/externalFile";

/**
 * 配置 Chromium 启动参数以优化内存占用
 */
const configureMemoryOptimizations = (): void => {
  // 禁止预热备用渲染进程
  app.commandLine.appendSwitch("disable-features", "SpareRendererForSitePerProcess");
  if (isHeadless()) {
    // 真正的无窗口运行不应依赖 X11/Wayland，也不需要 GPU 辅助进程。
    app.commandLine.appendSwitch("headless");
    app.commandLine.appendSwitch("disable-gpu");
    app.disableHardwareAcceleration();
  }
};

/** 内存指标采样间隔 */
const MEMORY_LOG_INTERVAL_MS = 10 * 60 * 1000;
/** 启动后首次采样延迟，避开启动期波动 */
const MEMORY_LOG_FIRST_DELAY_MS = 60 * 1000;

/** 记录各进程内存工作集，用于量化内存表现与防劣化对比 */
const logProcessMemory = (): void => {
  // pid → 窗口名，让 Tab 进程能区分主窗口与各歌词窗口
  const windowPids = new Map<number, string>();
  const namedWindows: Array<[string, Electron.BrowserWindow | null]> = [
    ["main", getMainWindow()],
    ["desktop-lyric", getDesktopLyricWindow()],
    ["dynamic-island", getDynamicIslandWindow()],
    ["taskbar-lyric", getTaskbarLyricWindow()],
  ];
  for (const [name, win] of namedWindows) {
    if (win && !win.isDestroyed()) windowPids.set(win.webContents.getOSProcessId(), name);
  }
  const parts = app.getAppMetrics().map((metric) => {
    const mb = Math.round(metric.memory.workingSetSize / 1024);
    const detail = windowPids.get(metric.pid) ?? metric.name ?? metric.serviceName;
    const label = detail ? `${metric.type}(${detail})` : metric.type;
    return `${label} ${mb}MB`;
  });
  coreLog.info(`内存占用: ${parts.join(" | ")}`);
};

/**
 * 初始化应用
 */
export const initApp = (): void => {
  configureMemoryOptimizations();
  configureDesktopEventSink(sendToMain);
  // 初始化日志
  initLogger();
  // 单例锁
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }
  app.on("second-instance", (_event, commandLine) => {
    if (isHeadless()) return;
    focusMainWindow();
    const url = extractOrpheusUrl(commandLine);
    if (url) captureOrpheusUrl(url);
    const files = extractAudioFiles(commandLine);
    if (files.length > 0) captureAudioFiles(files);
  });
  // macOS 通过 open-url 接收协议唤起
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (!isHeadless()) captureOrpheusUrl(url);
  });
  // 注册缓存与 Desktop 内部 Core Control 协议方案
  // macOS 通过 open-file 接收外部文件打开
  app.on("open-file", (event, path) => {
    event.preventDefault();
    if (!isHeadless()) captureAudioFiles([path]);
  });
  registerCacheScheme();
  registerCoreControlScheme();
  // 其他初始化
  app.whenReady().then(async () => {
    const headless = isHeadless();
    electronApp.setAppUserModelId("io.github.bnqzzdf.splayer-atom");
    // 注册 cache:// 与 Desktop 主 Control 的内部 Core Protocol 处理
    handleCacheProtocol();
    handleCoreControlProtocolOnPartition(MAIN_PARTITION);
    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });
    // 注册 IPC
    registerIpcHandlers();
    // 初始化数据库
    initDatabase();
    // 启动歌曲缓存
    void initSongCache();
    // 下载任务属于 Core；Control 是否存在不影响队列执行。
    void initDownload();
    if (!headless) {
      initMedia();
      initLastfm();
      registerDesktopPlaybackPresentation();
    }
    // 初始化插件系统
    pluginRegistry.init();
    registerPluginControlEvents();
    initListenBrainz();
    // 初始化播放事件桥（需在 pluginRegistry.init 之后，读 hasEnabledControlPlugin）
    initPlaybackBridge();
    if (!headless) {
      // Desktop-only shell. Headless keeps the same core but creates no renderer/window services.
      initOrpheusRegistration();
      const coldOrpheusUrl = extractOrpheusUrl(process.argv);
      if (coldOrpheusUrl) captureOrpheusUrl(coldOrpheusUrl);
      const coldAudioFiles = extractAudioFiles(process.argv);
      if (coldAudioFiles.length > 0) captureAudioFiles(coldAudioFiles);
      createMainWindow();
      restoreLyricWindows();
      initGlobalHotkey();
    }
    // 主进程播放 session 在服务端启动前就绪，保证浏览器不是状态所有者。
    await initPlaybackSession();
    await startServer();
    if (!headless) {
      void startMcpServer();
      initUpdater();
    }
    // 周期记录各进程内存
    setTimeout(logProcessMemory, MEMORY_LOG_FIRST_DELAY_MS);
    setInterval(logProcessMemory, MEMORY_LOG_INTERVAL_MS);
    app.on("activate", () => {
      if (headless) return;
      if (isMac) {
        if (getMainWindow()) focusMainWindow();
        else createMainWindow();
        return;
      }
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
    coreLog.info(headless ? "应用初始化完成 (headless)" : "应用初始化完成");
  });
  // 所有窗口关闭时退出应用
  app.on("window-all-closed", () => {
    if (isHeadless()) return;
    if (process.platform !== "darwin") app.quit();
  });
  // 退出前清理
  app.on("before-quit", () => {
    coreLog.info("应用即将退出，清理资源");
    store.flushImmediate();
    void shutdownPlaybackSession();
    shutdownSongCache();
    shutdownDownload();
    shutdownCorePlayStats();
    shutdownListenBrainz();
    shutdownMedia();
    closeDatabase();
    void stopServer();
    void stopMcpServer();
    unregisterPluginControlEvents();
    void pluginRegistry.shutdown();
    disposePlaybackBridge();
    disposeUpdater();
  });
};
