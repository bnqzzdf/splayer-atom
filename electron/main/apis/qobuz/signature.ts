import { createHash } from "node:crypto";

/**
 * 构造 Qobuz v0.2 签名原文。
 * @param endpoint - 形如 `track/getFileUrl` 的接口路径
 * @param params - 参与签名的业务参数
 * @param timestamp - Unix 秒时间戳
 * @param secret - Qobuz Application secret
 * @returns MD5 前的签名原文
 */
export const buildQobuzSignaturePayload = (
  endpoint: string,
  params: Record<string, string | number>,
  timestamp: number,
  secret: string,
): string => {
  const [method, action] = endpoint.split("/");
  if (!method || !action) throw new Error(`无效的 Qobuz endpoint: ${endpoint}`);
  const paramString = Object.keys(params)
    .sort()
    .map((key) => `${key}${String(params[key])}`)
    .join("");
  return `${method}${action}${paramString}${timestamp}${secret}`;
};

/**
 * 生成 Qobuz v0.2 request_sig。
 * @param endpoint - 形如 `track/getFileUrl` 的接口路径
 * @param params - 参与签名的业务参数
 * @param timestamp - Unix 秒时间戳
 * @param secret - Qobuz Application secret
 * @returns 十六进制 MD5 签名
 */
export const buildQobuzSignature = (
  endpoint: string,
  params: Record<string, string | number>,
  timestamp: number,
  secret: string,
): string =>
  createHash("md5")
    .update(buildQobuzSignaturePayload(endpoint, params, timestamp, secret))
    .digest("hex");
