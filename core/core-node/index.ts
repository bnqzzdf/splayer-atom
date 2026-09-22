import { fileURLToPath } from "node:url";
import { runtimeEnvironment } from "@main/atom/runtime/environment";
import { assertSupportedCoreNodeRuntime } from "@main/atom/runtime/nodeRuntime";

assertSupportedCoreNodeRuntime();

process.env.ATOM_APP_NAME ??= "SPlayer Atom Core";
process.env.ATOM_APP_PACKAGED ??= process.env.NODE_ENV === "production" ? "1" : "0";
if (process.env.ATOM_APP_PACKAGED === "1") {
  process.env.ATOM_DATA_DIR ??= fileURLToPath(new URL("../data", import.meta.url));
}
process.env.ATOM_CACHE_DIR ??= runtimeEnvironment.defaultCoreCacheDir;
process.env.ATOM_LOG_STDIO_ONLY ??= "1";
process.env.ATOM_RENDERER_DIR ??= fileURLToPath(new URL("../renderer", import.meta.url));
process.env.ATOM_NATIVE_DIR ??= fileURLToPath(new URL("../native", import.meta.url));
process.env.ATOM_PLUGIN_HOST_ENTRY ??= fileURLToPath(new URL("./plugin-host.js", import.meta.url));
process.env.ATOM_LISTENBRAINZ_CHILD_ENTRY ??= fileURLToPath(
  new URL("./listenbrainz-child.js", import.meta.url),
);
// bundled `ws` 不加载可选原生加速模块，避免 Rollup 的 CommonJS 包装破坏其导出形状。
process.env.WS_NO_BUFFER_UTIL ??= "1";
process.env.WS_NO_UTF_8_VALIDATE ??= "1";

let shuttingDown = false;

const start = async (): Promise<void> => {
  const { prepareCoreDataMigration } = await import("@main/atom/runtime/dataMigration");
  const migrationBackup = prepareCoreDataMigration();

  const [
    { initLogger, coreLog },
    database,
    songCache,
    playbackSession,
    corePlayerEvents,
    downloadManager,
    server,
    { store },
    { pluginRegistry },
    { registerPluginControlEvents },
    listenbrainz,
  ] = await Promise.all([
    import("@main/utils/logger"),
    import("@main/database"),
    import("@main/services/songCache"),
    import("@main/services/playbackSession"),
    import("@main/services/corePlayerEvents"),
    import("@main/services/downloadManager"),
    import("@main/server"),
    import("@main/store"),
    import("@main/plugins/registry"),
    import("@main/services/pluginControl"),
    import("@main/services/listenbrainz"),
  ]);

  initLogger();
  if (migrationBackup) coreLog.info(`Core 数据迁移备份已创建: ${migrationBackup}`);
  database.initDatabase();
  await songCache.init();
  pluginRegistry.init();
  registerPluginControlEvents();
  listenbrainz.initListenBrainz();
  corePlayerEvents.registerCorePlayerEvents();
  await downloadManager.init();
  await playbackSession.initPlaybackSession();

  const status = await server.startServer();
  if (!status.listening) {
    throw new Error(status.error?.message ?? "Atom Core HTTP/WS server failed to start");
  }

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    coreLog.info(`Atom Core 收到 ${signal}，保存用户配置后退出`);
    let exitCode = 0;
    try {
      // SIGTERM 表示整个进程即将消失；只保证仍在内存中的用户配置落盘，
      // 播放、下载、网络连接和 native runtime 都交给操作系统直接回收。
      store.flushImmediate();
    } catch (error) {
      exitCode = 1;
      coreLog.error("退出前保存用户配置失败", error);
    }
    process.exit(exitCode);
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  coreLog.info(`Atom Core 已启动: ${status.host ?? "0.0.0.0"}:${status.port ?? 14558}`);
};

void start().catch((error) => {
  console.error("Atom Core 启动失败", error);
  process.exitCode = 1;
});
