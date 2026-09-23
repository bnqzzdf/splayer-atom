import { clearQobuzAuth, getQobuzAuth, getQobuzAuthStatus, setQobuzAuth } from "./auth";
import { callStreamingNative } from "@main/apis/streamingNative";

export type QobuzParams = Record<string, unknown>;

const nativeAuth = (): Record<string, unknown> => {
  const auth = getQobuzAuth();
  if (!auth) return {};
  return {
    user_id: auth.userId,
    user_auth_token: auth.token,
  };
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const stringValue = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
};

/**
 * 把原生登录响应投影成 Core 会话并落库。
 *
 * `auth_login`（粘贴 token）与 `auth_oauth_await`（一键 OAuth）共用，
 * 保证两条登录路径写出来的会话字段完全一致。
 *
 * `fallback` 用于兼容「调用方直接把 token/userId 传进来」的粘贴路径：
 * 原生响应缺字段时回退到请求参数。
 */
const persistQobuzSession = (
  response: Record<string, unknown>,
  fallback: QobuzParams = {},
): unknown => {
  const token =
    stringValue(response.user_auth_token) ??
    stringValue(fallback.user_auth_token) ??
    stringValue(fallback.userAuthToken);
  if (!token) throw new Error("Qobuz 登录响应缺少 user_auth_token");

  const user = asRecord(response.user);
  const userId =
    stringValue(response.user_id) ??
    stringValue(user.id) ??
    stringValue(fallback.user_id) ??
    stringValue(fallback.userId);
  const username =
    stringValue(response.display_name) ??
    stringValue(user.login) ??
    stringValue(user.display_name) ??
    userId;

  setQobuzAuth({ token, userId, username });
  return response;
};

const authLogin = async (params: QobuzParams): Promise<unknown> => {
  const response = asRecord(await callStreamingNative("qobuz", "auth_login", nativeAuth(), params));
  return persistQobuzSession(response, params);
};

const authStatus = async (): Promise<unknown> => {
  if (!getQobuzAuth()) return getQobuzAuthStatus();
  return callStreamingNative("qobuz", "auth_status", nativeAuth(), {});
};

/**
 * 一键 OAuth 第一步：让原生层起一次性本地回调监听，拿回授权 URL。
 *
 * 此时尚未登录，不投影会话；拿到 code 后由 `authOauthAwait` 落库。
 */
const authOauthStart = async (params: QobuzParams): Promise<unknown> =>
  callStreamingNative("qobuz", "auth_oauth_start", {}, params);

/**
 * 一键 OAuth 第二步：等浏览器回调 → 兑换 token → 落库。
 *
 * 刻意不传 `nativeAuth()`：此时是未登录状态，遗留的旧 token 会被
 * `QobuzClient` 带进请求头，反而干扰兑换。
 */
const authOauthAwait = async (params: QobuzParams): Promise<unknown> => {
  const response = asRecord(await callStreamingNative("qobuz", "auth_oauth_await", {}, params));
  return persistQobuzSession(response);
};

const authLogout = async (): Promise<unknown> => {
  try {
    return await callStreamingNative("qobuz", "auth_logout", nativeAuth(), {});
  } finally {
    clearQobuzAuth();
  }
};

/**
 * Qobuz Core 入口：session 由 Node Core 持有，平台协议全部委托给 Rust streaming-api。
 */
export const callQobuz = async (name: string, params: QobuzParams = {}): Promise<unknown> => {
  if (name === "auth_login" || name === "login") return authLogin(params);
  if (name === "auth_oauth_start" || name === "oauth_start") return authOauthStart(params);
  if (name === "auth_oauth_await" || name === "oauth_await") return authOauthAwait(params);
  if (name === "auth_status" || name === "status" || name === "user_detail") {
    return authStatus();
  }
  if (name === "auth_logout" || name === "logout") return authLogout();

  const response = await callStreamingNative("qobuz", name, nativeAuth(), params);
  if (name === "track_getFileUrl" || name === "song_url") {
    const record = asRecord(response);
    const data = asRecord(record.data);
    return { ...data, raw: record.raw };
  }
  return response;
};
