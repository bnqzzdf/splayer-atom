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

const authLogin = async (params: QobuzParams): Promise<unknown> => {
  const response = asRecord(await callStreamingNative("qobuz", "auth_login", nativeAuth(), params));
  const token =
    stringValue(response.user_auth_token) ??
    stringValue(params.user_auth_token) ??
    stringValue(params.userAuthToken);
  if (!token) throw new Error("Qobuz 登录响应缺少 user_auth_token");

  const user = asRecord(response.user);
  const userId =
    stringValue(response.user_id) ??
    stringValue(user.id) ??
    stringValue(params.user_id) ??
    stringValue(params.userId);
  const username =
    stringValue(response.display_name) ??
    stringValue(user.login) ??
    stringValue(user.display_name) ??
    userId;

  setQobuzAuth({ token, userId, username });
  return response;
};

const authStatus = async (): Promise<unknown> => {
  if (!getQobuzAuth()) return getQobuzAuthStatus();
  return callStreamingNative("qobuz", "auth_status", nativeAuth(), {});
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
