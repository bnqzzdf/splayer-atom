import path from "node:path";

process.env.ATOM_HEADLESS = "1";
process.env.ATOM_APP_NAME ??= "SPlayer Atom Core";
process.env.ATOM_APP_VERSION ??= "1.0.0";
process.env.ATOM_APP_PACKAGED ??= process.env.NODE_ENV === "production" ? "1" : "0";
process.env.ATOM_RENDERER_DIR ??= path.join(process.cwd(), "out", "renderer");

let shuttingDown = false;

const start = async (): Promise<void> => {
  const [{ initLogger, coreLog }, database, songCache, playbackSession, server, { store }] =
    await Promise.all([
      import("@main/utils/logger"),
      import("@main/database"),
      import("@main/services/songCache"),
      import("@main/services/playbackSession"),
      import("@main/server"),
      import("@main/store"),
    ]);

  initLogger();
  database.initDatabase();
  await songCache.init();
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
