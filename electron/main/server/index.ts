/**
 * 外部 API 服务器：HTTP (Hono) + WebSocket
 */

import type { Server } from "node:http";
import os from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve, upgradeWebSocket } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { WebSocketServer } from "ws";
import { store } from "@main/store";
import { serverLog } from "@main/utils/logger";
import {
  getArtistCacheDir,
  getBackgroundsDir,
  getCoverCacheDir,
} from "@main/utils/config";
import { broadcast } from "@main/utils/broadcast";
import type { ExternalApiStatus } from "@shared/types/settings";
import { buildAtomCompatRoutes } from "@main/atom/compat/routes";
import { buildHeadlessRoutes } from "@main/atom/headless/routes";
import { getHeadlessServerPort, isHeadlessMode } from "@main/runtime";
import { externalControlGate, wsGate } from "./gate";
import { buildRoutes } from "./routes";
import { wsHandlers } from "./ws";

let runningServer: Server | null = null;
let runningWss: WebSocketServer | null = null;
let runningPort: number | null = null;
let runningHost: string | null = null;
let runningAllowLan = false;
let lastError: { code: string; message: string } | null = null;

/**
 * 取局域网展示地址，绑定 0.0.0.0 时作为展示给用户的局域网入口
 * 优先常见家用/企业网段：WSL2/Hyper-V 的虚拟交换机常占用 172.x 且排在物理网卡前
 */
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

export const getServerStatus = (): ExternalApiStatus => ({
  listening: runningServer !== null,
  allowLan: runningAllowLan,
  host: runningHost,
  port: runningPort,
  error: lastError,
});

/** 向渲染进程同步外部 API 服务状态 */
const publishStatus = (): void => broadcast("externalApi:status", getServerStatus());

/** 启动外部 API 服务 */
export const startServer = (): Promise<ExternalApiStatus> => {
  return new Promise((resolve) => {
    if (runningServer) {
      resolve(getServerStatus());
      return;
    }
    const headless = isHeadlessMode();
    // Desktop keeps the existing opt-in behavior; headless always exposes its control plane on LAN.
    if (!headless && !store.get("externalApi.enabled")) {
      resolve(getServerStatus());
      return;
    }

    const port = headless ? getHeadlessServerPort() : store.get("externalApi.port");
    const hostname = headless || store.get("externalApi.allowLan") ? "0.0.0.0" : "127.0.0.1";

    const app = new Hono();
    if (headless) {
      if (process.env.ELECTRON_RENDERER_URL) app.use("/api/*", cors());
      app.route("/api", buildHeadlessRoutes());
      app.route("/api", buildAtomCompatRoutes());
      app.get("/ws", upgradeWebSocket(() => wsHandlers));
    } else {
      app.use("/api/*", externalControlGate);
      app.route("/api", buildRoutes());
      app.route("/api", buildAtomCompatRoutes());
      app.get(
        "/ws",
        externalControlGate,
        wsGate,
        upgradeWebSocket(() => wsHandlers),
      );
    }
    if (headless) {
      const cacheRoute = (prefix: string, root: string) =>
        serveStatic({
          root,
          rewriteRequestPath: (requestPath) => requestPath.slice(prefix.length) || "/",
        });
      // 只暴露 UI 需要的图像缓存；歌曲缓存绝不作为静态目录对局域网开放。
      const imageCaches = [
        ["/cache/covers", getCoverCacheDir()],
        ["/cache/artists", getArtistCacheDir()],
        ["/cache/backgrounds", getBackgroundsDir()],
      ] as const;
      for (const [prefix, root] of imageCaches) {
        if (existsSync(root)) app.use(`${prefix}/*`, cacheRoute(prefix, root));
      }
    }
    if (headless && !process.env.ELECTRON_RENDERER_URL) {
      // Production headless serves the same built Vue renderer; no second web service is started.
      const rendererRoot = join(__dirname, "../renderer");
      app.get("/", serveStatic({ root: rendererRoot, path: "index.html" }));
      app.get("/debug", serveStatic({ root: rendererRoot, path: "index.html" }));
      app.use("/*", serveStatic({ root: rendererRoot }));
    } else {
      app.get("/", (c) =>
        c.text(
          headless
            ? "Atom headless API (development UI is served by electron-vite)"
            : "SPlayer Next external API",
        ),
      );
    }

    const wss = new WebSocketServer({ noServer: true });
    let settled = false;

    const server = serve({
      fetch: app.fetch,
      port,
      hostname,
      websocket: { server: wss },
    }) as Server;

    // error / listening 互斥：先到先 settle
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      const error = { code: err.code ?? "UNKNOWN", message: err.message };
      serverLog.error(`外部 API 监听 ${port} 失败 (${error.code}): ${error.message}`);
      wss.close();
      try {
        server.close();
      } catch {
        // server.close 在 listen 失败的情况下可能抛 ERR_SERVER_NOT_RUNNING，忽略
      }
      runningServer = null;
      runningWss = null;
      runningPort = null;
      runningHost = null;
      runningAllowLan = false;
      lastError = error;
      publishStatus();
      resolve(getServerStatus());
    });

    server.once("listening", () => {
      if (settled) return;
      settled = true;
      runningServer = server;
      runningWss = wss;
      runningPort = port;
      runningAllowLan = hostname === "0.0.0.0";
      runningHost = runningAllowLan ? (getLanAddress() ?? "0.0.0.0") : hostname;
      lastError = null;
      publishStatus();
      serverLog.info(`外部 API 已启动: http://${hostname}:${port}`);
      resolve(getServerStatus());
    });
  });
};

/** 停止外部 API 服务 */
export const stopServer = (): Promise<void> => {
  if (!runningServer) return Promise.resolve();
  const server = runningServer;
  const wss = runningWss;
  runningServer = null;
  runningWss = null;
  runningPort = null;
  runningHost = null;
  runningAllowLan = false;
  publishStatus();
  const serverClosed = new Promise<void>((resolve) => {
    wss?.close();
    server.close((err) => {
      if (err) serverLog.warn("外部 API 关闭异常:", err);
      else serverLog.info("外部 API 已关闭");
      resolve();
    });
  });
  return serverClosed;
};

/** 配置变更后重启服务 */
export const restartServer = async (): Promise<ExternalApiStatus> => {
  await stopServer();
  return startServer();
};
