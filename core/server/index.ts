/** Core HTTP + WebSocket + Web Control server. */

import type { Server } from "node:http";
import os from "node:os";
import { join } from "node:path";
import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { serve, upgradeWebSocket } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { WebSocketServer } from "ws";
import { serverLog } from "@main/utils/logger";
import { getArtistCacheDir, getBackgroundsDir, getCoverCacheDir } from "@main/utils/config";
import { buildCoreControlRoutes } from "@main/atom/controlRoutes";
import { getCoreServerPort } from "@main/runtime";
import { wsHandlers } from "./ws";
import { createDynamicCacheRoute } from "./cacheRoute";

let runningServer: Server | null = null;
let runningWss: WebSocketServer | null = null;
let runningPort: number | null = null;
let runningHost: string | null = null;
let lastError: { code: string; message: string } | null = null;

export interface CoreServerStatus {
  listening: boolean;
  host: string | null;
  port: number | null;
  error: { code: string; message: string } | null;
}

const getLanAddress = (): string | null => {
  const candidates: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === "IPv4" && !item.internal) candidates.push(item.address);
    }
  }
  return (
    candidates.find((address) => address.startsWith("192.168.")) ??
    candidates.find((address) => address.startsWith("10.")) ??
    candidates[0] ??
    null
  );
};

export const getServerStatus = (): CoreServerStatus => ({
  listening: runningServer !== null,
  host: runningHost,
  port: runningPort,
  error: lastError,
});

/** 启动 Core Control 与 Web Control 服务。 */
export const startServer = (): Promise<CoreServerStatus> =>
  new Promise((resolve) => {
    if (runningServer) {
      resolve(getServerStatus());
      return;
    }

    const port = getCoreServerPort();
    const hostname = "0.0.0.0";
    const app = new Hono();

    if (process.env.ATOM_WEB_DEV_URL) app.use("/api/*", cors());
    app.route("/api", buildCoreControlRoutes());
    app.get(
      "/ws",
      upgradeWebSocket(() => wsHandlers),
    );

    const imageCaches = [
      ["/cache/covers", getCoverCacheDir],
      ["/cache/artists", getArtistCacheDir],
      ["/cache/backgrounds", getBackgroundsDir],
    ] as const;
    for (const [prefix, getRoot] of imageCaches) {
      app.use(`${prefix}/*`, createDynamicCacheRoute(prefix, getRoot));
    }

    if (!process.env.ATOM_WEB_DEV_URL) {
      const rendererRoot = process.env.ATOM_RENDERER_DIR || join(__dirname, "../renderer");
      const rendererEntry = serveStatic({ root: rendererRoot, path: "index.html" });
      const disableRendererEntryCache: MiddlewareHandler = async (c, next) => {
        c.header("Cache-Control", "no-store");
        await next();
      };
      app.get("/", disableRendererEntryCache, rendererEntry);
      app.get("/debug", disableRendererEntryCache, rendererEntry);
      app.use("/*", serveStatic({ root: rendererRoot }));
    } else {
      app.get("/", (c) => c.text("SPlayer Atom Core API; Web Control is served by Vite"));
    }

    const wss = new WebSocketServer({ noServer: true });
    let settled = false;
    const server = serve({
      fetch: app.fetch,
      port,
      hostname,
      websocket: { server: wss },
    }) as Server;

    server.once("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      const error = { code: err.code ?? "UNKNOWN", message: err.message };
      serverLog.error(`Core HTTP/WS 监听 ${port} 失败 (${error.code}): ${error.message}`);
      wss.close();
      try {
        server.close();
      } catch {}
      runningServer = null;
      runningWss = null;
      runningPort = null;
      runningHost = null;
      lastError = error;
      resolve(getServerStatus());
    });

    server.once("listening", () => {
      if (settled) return;
      settled = true;
      runningServer = server;
      runningWss = wss;
      runningPort = port;
      runningHost = getLanAddress() ?? "0.0.0.0";
      lastError = null;
      serverLog.info(`Core HTTP/WS 已启动: http://${hostname}:${port}`);
      resolve(getServerStatus());
    });
  });

export const stopServer = (): Promise<void> => {
  if (!runningServer) return Promise.resolve();
  const server = runningServer;
  const wss = runningWss;
  runningServer = null;
  runningWss = null;
  runningPort = null;
  runningHost = null;
  return new Promise((resolve) => {
    for (const client of wss?.clients ?? []) {
      client.close(1001, "Core server stopping");
    }
    wss?.close();
    server.close((error) => {
      if (error) serverLog.warn("Core HTTP/WS 关闭异常:", error);
      else serverLog.info("Core HTTP/WS 已关闭");
      resolve();
    });
  });
};

export const restartServer = async (): Promise<CoreServerStatus> => {
  await stopServer();
  return startServer();
};
