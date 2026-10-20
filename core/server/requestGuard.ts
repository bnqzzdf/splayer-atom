import { isIP } from "node:net";
import type { MiddlewareHandler } from "hono";

/** 局域网内常见的私有域名后缀；公网域名可能被 DNS rebinding 指向本机。 */
const LAN_HOST_SUFFIXES = [".local", ".lan", ".home.arpa", ".internal", ".localdomain"];

const extraAllowedHosts = (): Set<string> =>
  new Set(
    (process.env.ATOM_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );

/** 从 Host 头取主机名（去掉端口与 IPv6 方括号）。 */
const hostnameOf = (host: string): string => {
  const value = host.trim().toLowerCase();
  if (value.startsWith("[")) return value.slice(1, value.indexOf("]"));
  const colon = value.lastIndexOf(":");
  return colon >= 0 ? value.slice(0, colon) : value;
};

/**
 * Host 是否属于本机/局域网访问方式。
 * IP、localhost、无点主机名与私有后缀放行；其余公网域名需显式写入 ATOM_ALLOWED_HOSTS。
 * @param hostname - 已去端口的主机名
 * @returns 是否可信
 */
export const isTrustedHostname = (hostname: string): boolean => {
  if (isIP(hostname) !== 0 || hostname === "localhost" || !hostname.includes(".")) return true;
  if (LAN_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return true;
  return extraAllowedHosts().has(hostname);
};

/**
 * 拦截跨站请求与 DNS rebinding。
 *
 * Core 没有鉴权，浏览器里任意网页都能向局域网 IP 发 no-cors 简单请求（text/plain 也会被
 * `c.req.json()` 解析）；浏览器对跨源 POST 与 WebSocket 必带 Origin，据此只放行同源 Web Control。
 * 不带 Origin 的请求来自 curl/脚本等非浏览器客户端，不存在 CSRF 风险，保持放行。
 * @param options.devSameHostAnyPort - 开发模式下 Vite 与 Core 端口不同，放行同主机名的 Origin
 * @returns Hono 中间件
 */
export const createRequestGuard =
  (options: { devSameHostAnyPort?: boolean } = {}): MiddlewareHandler =>
  async (c, next) => {
    const host = c.req.header("host") ?? "";
    const hostname = hostnameOf(host);
    // 缺少 Host 的只可能是非浏览器客户端；DNS rebinding 必然携带攻击者域名作为 Host。
    if (hostname && !isTrustedHostname(hostname)) return c.text("untrusted host", 403);

    const origin = c.req.header("origin");
    if (origin && origin !== "null") {
      let originUrl: URL;
      try {
        originUrl = new URL(origin);
      } catch {
        return c.text("invalid origin", 403);
      }
      const sameOrigin = originUrl.host.toLowerCase() === host.toLowerCase();
      const devAllowed =
        options.devSameHostAnyPort === true && hostnameOf(originUrl.host) === hostname;
      if (!sameOrigin && !devAllowed) return c.text("cross-origin request rejected", 403);
    } else if (origin === "null") {
      // sandbox iframe / file:// 等不透明来源一律拒绝。
      return c.text("opaque origin rejected", 403);
    }
    await next();
  };
