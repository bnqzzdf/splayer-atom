import { fileURLToPath } from "node:url";
import { runtimeEnvironment } from "@main/atom/runtime/environment";
import { assertSupportedCoreNodeRuntime } from "@main/atom/runtime/nodeRuntime";

assertSupportedCoreNodeRuntime();

process.env.ATOM_HEADLESS = "1";
process.env.ATOM_APP_NAME ??= "SPlayer Atom Core";
process.env.ATOM_APP_VERSION ??= "1.0.0";
process.env.ATOM_APP_PACKAGED ??= process.env.NODE_ENV === "production" ? "1" : "0";
if (process.env.ATOM_APP_PACKAGED === "1") {
  process.env.ATOM_DATA_DIR ??= fileURLToPath(new URL("../data", import.meta.url));
}
process.env.ATOM_CACHE_DIR ??= runtimeEnvironment.defaultCoreCacheDir;
process.env.ATOM_LOG_STDIO_ONLY ??= "1";
process.env.ATOM_RENDERER_DIR ??= fileURLToPath(new URL("../renderer", import.meta.url));
process.env.ATOM_NATIVE_DIR ??= fileURLToPath(new URL("../native", import.meta.url));
process.env.ATOM_PLUGIN_HOST_ENTRY ??= fileURLToPath(new URL("./plugin-host.js", import.meta.url));

let shuttingDown = false;

const start = async (): Promise<void> => {
  const [
    { initLogger, coreLog },
    database,
    songCache,
    playbackSession,
    corePlayerEvents,
    server,
    { store },
    { pluginRegistry },
  ] = await Promise.all([
    import("@main/utils/logger"),
    import("@main/database"),
    import("@main/services/songCache"),
    import("@main/services/playbackSession"),
    import("@main/services/corePlayerEvents"),
    import("@main/server"),
    import("@main/store"),
    import("@main/plugins/registry"),
  ]);

  initLogger();
  database.initDatabase();
  await songCache.init();
  pluginRegistry.init();
  corePlayerEvents.registerCorePlayerEvents();
  await playbackSession.initPlaybackSession();

  const status = await server.startServer();
  if (!status.listening) {
    throw new Error(status.error?.message ?? "Atom Core HTTP/WS server failed to start");
  }

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    coreLog.info(`Atom Core 收到 ${signal}，开始停止服务`);
    store.flushImmediate();
    songCache.shutdown();
    await pluginRegistry.shutdown();
    await server.stopServer();
    database.closeDatabase();
    process.exitCode = 0;
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  coreLog.info(`Atom Core 已启动: ${status.host ?? "0.0.0.0"}:${status.port ?? 14558}`);
};

void start().catch((error) => {
  console.error("Atom Core 启动失败", error);
  process.exitCode = 1;
});
