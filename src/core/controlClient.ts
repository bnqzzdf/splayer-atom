import { assertCoreProtocolCompatible } from "@shared/constants/coreProtocol";
import type { CoreInfo } from "@shared/types/core";
import type { IpcResponse } from "@shared/types/player";

const desktopControl =
  typeof document !== "undefined" && document.documentElement.dataset.atomRuntime === "desktop";
const location = typeof window !== "undefined" ? window.location : null;
const host = location?.hostname || "127.0.0.1";
const dev = import.meta.env?.DEV === true;

/**
 * 当前 Control 使用的 Core Protocol origin。
 * Desktop 通过 Electron session 内部 scheme 访问；Web 继续使用同源/开发 HTTP。
 */
export const coreApiOrigin = desktopControl
  ? "atom-core://control"
  : location
    ? dev
      ? `${location.protocol}//${host}:14559`
      : location.origin
    : "";

const rawRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${coreApiOrigin}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await response.json().catch(() => null)) as T | { error?: string } | null;
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data ? data.error : null;
    throw new Error(message || `HTTP ${response.status}`);
  }
  return data as T;
};

let coreInfoPromise: Promise<CoreInfo> | null = null;

/** 获取并缓存 Core 兼容信息；网络失败允许下一次请求重新探测。 */
export const getCoreInfo = (): Promise<CoreInfo> => {
  coreInfoPromise ??= rawRequest<CoreInfo>("/info").catch((error) => {
    coreInfoPromise = null;
    throw error;
  });
  return coreInfoPromise;
};

/** 当前 Control 在任何 domain 请求前先验证 Core Protocol。 */
export const ensureCoreProtocolCompatible = async (): Promise<CoreInfo> => {
  const info = await getCoreInfo();
  assertCoreProtocolCompatible(info);
  return info;
};

/** 发送一条共享 Core Protocol 请求。 */
export const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  if (path !== "/info") await ensureCoreProtocolCompatible();
  return rawRequest<T>(path, init);
};

/** 将任意 Core Protocol 请求投影成现有 IpcResponse 形状。 */
export const coreResult = async <T>(path: string, init?: RequestInit): Promise<IpcResponse<T>> => {
  try {
    return { success: true, data: await request<T>(path, init) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};

/** 将无返回值的 Core Protocol POST 命令投影成现有 IpcResponse 形状。 */
export const coreCommand = async (path: string, body?: unknown): Promise<IpcResponse> => {
  try {
    await request(path, {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};
