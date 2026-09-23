/**
 * 主进程音源 API 统一类型
 */

/** 支持的音源平台 */
export type ApiPlatform = "netease" | "qqmusic" | "kugou" | "qobuz" | "tidal";

/** Atom 主动维护并投影登录态的在线平台。 */
export const MANAGED_PROVIDER_PLATFORMS = [
  "netease",
  "qqmusic",
  "kugou",
  "qobuz",
  "tidal",
] as const;
export type ManagedProviderPlatform = (typeof MANAGED_PROVIDER_PLATFORMS)[number];

/** 判断平台是否属于 Atom 正式维护的 Provider Core Domain。 */
export const isManagedProviderPlatform = (value: unknown): value is ManagedProviderPlatform =>
  typeof value === "string" &&
  MANAGED_PROVIDER_PLATFORMS.includes(value as ManagedProviderPlatform);

/** Control 可安全读取的 Provider session 投影，不包含 cookie/token。 */
export interface ProviderSessionState {
  authenticated: boolean;
  userId?: string;
  username?: string;
  countryCode?: string;
  expiresAt?: number;
  refreshable?: boolean;
}

export type ProviderSessionsSnapshot = Record<ManagedProviderPlatform, ProviderSessionState>;

/** 通用响应包装 */
export type ApiCallResponse =
  | { ok: true; status?: number; body?: unknown; data?: unknown }
  | { ok: false; error: string; status?: number; body?: unknown };
