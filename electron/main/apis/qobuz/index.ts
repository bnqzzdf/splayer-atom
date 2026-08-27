import { clearQobuzAuth, getQobuzAuthStatus, setQobuzAuth } from "./auth";
import { qobuzRequest } from "./request";

export type QobuzParams = Record<string, unknown>;

interface QobuzUserResponse {
  id?: string | number;
  login?: string;
  email?: string;
  display_name?: string;
  user?: {
    id?: string | number;
    login?: string;
    email?: string;
    display_name?: string;
  };
}

const authLogin = async (params: QobuzParams): Promise<unknown> => {
  const token = String(params.user_auth_token ?? "").trim();
  if (!token) throw new Error("缺少 Qobuz user_auth_token");

  const response = await qobuzRequest<QobuzUserResponse>("user/get", {}, {
    authRequired: false,
    authToken: token,
  });
  const user = response.user ?? response;
  const userId = user.id === undefined ? undefined : String(user.id);
  const username = user.login || user.display_name || user.email || userId;
  setQobuzAuth({ userId, username, token });
  return { loggedIn: true, userId, username };
};

const catalogSearch = (params: QobuzParams): Promise<unknown> => {
  const query = String(params.query ?? "").trim();
  if (!query) throw new Error("缺少 Qobuz 搜索关键词");
  const type = String(params.type ?? "tracks").trim();
  const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 50);
  const offset = Math.max(Number(params.offset) || 0, 0);
  return qobuzRequest(
    "catalog/search",
    { query, type, limit, offset },
    { signed: true },
  );
};

const trackGetFileUrl = (params: QobuzParams): Promise<unknown> => {
  const trackId = String(params.track_id ?? "").trim();
  const formatId = String(params.format_id ?? "6").trim();
  if (!trackId) throw new Error("缺少 Qobuz track_id");
  return qobuzRequest(
    "track/getFileUrl",
    { track_id: trackId, format_id: formatId, intent: "stream" },
    { signed: true },
  );
};

const handlers: Record<string, (params: QobuzParams) => Promise<unknown> | unknown> = {
  auth_login: authLogin,
  auth_status: () => getQobuzAuthStatus(),
  auth_logout: () => {
    clearQobuzAuth();
    return { loggedIn: false };
  },
  catalog_search: catalogSearch,
  track_getFileUrl: trackGetFileUrl,
};

/**
 * 调用 Qobuz API 的最小统一入口。
 * @param name - Qobuz 动作名
 * @param params - 动作参数
 * @returns 动作结果
 */
export const callQobuz = async (name: string, params: QobuzParams = {}): Promise<unknown> => {
  const handler = Object.hasOwn(handlers, name) ? handlers[name] : undefined;
  if (!handler) throw new Error(`unknown qobuz api: ${name}`);
  return handler(params);
};
