import { protocol, session } from "electron";
import { buildHeadlessRoutes } from "@main/atom/headless/routes";

/** Desktop renderer 内部使用的 Core Protocol scheme。 */
export const CORE_CONTROL_SCHEME = "atom-core";
const CORE_CONTROL_HOST = "control";
const API_PREFIX = "/api";
const ALLOWED_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";

const routes = buildHeadlessRoutes();

/** 给 Electron renderer 的跨 scheme Fetch 响应补齐最小 CORS 头。 */
const withCors = (response: Response): Response => {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

/**
 * 把 atom-core://control/api/* 请求直接转发给与 Web 相同的 Core Protocol router。
 * 不经过 external API 开关、LAN socket 或 Electron domain IPC。
 */
const handleCoreControlRequest = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  if (url.hostname !== CORE_CONTROL_HOST || !url.pathname.startsWith(`${API_PREFIX}/`)) {
    return withCors(new Response("Not Found", { status: 404 }));
  }
  if (request.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }));
  }

  const path = url.pathname.slice(API_PREFIX.length) || "/";
  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
  const forwarded = new Request(`http://atom-core.local${path}${url.search}`, {
    method,
    headers: request.headers,
    ...(body && body.byteLength > 0 ? { body } : {}),
  });
  return withCors(await routes.fetch(forwarded));
};

/** 必须在 app ready 前注册 scheme privilege。 */
export const registerCoreControlScheme = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: CORE_CONTROL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        corsEnabled: true,
        supportFetchAPI: true,
      },
    },
  ]);
};

/** 在 Desktop 主 renderer 使用的 partition 上安装内部 Core Protocol handler。 */
export const handleCoreControlProtocolOnPartition = (partition: string): void => {
  session.fromPartition(partition).protocol.handle(CORE_CONTROL_SCHEME, handleCoreControlRequest);
};
