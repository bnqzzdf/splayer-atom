import { clearTidalAuth, getTidalAuth, setTidalAuth, type TidalAuthState } from "./auth";
import {
  TIDAL_API_BASE,
  TIDAL_AUTH_BASE,
  TIDAL_DEFAULT_COUNTRY,
  TIDAL_TOKEN_REFRESH_MARGIN_MS,
  TIDAL_USER_AGENT,
} from "./config";

interface TidalTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

const readErrorBody = async (response: Response): Promise<string> => {
  try {
    const text = await response.text();
    if (!text) return `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(text) as {
        error?: string;
        error_description?: string;
        userMessage?: string;
      };
      return parsed.error_description || parsed.userMessage || parsed.error || text.slice(0, 200);
    } catch {
      return text.slice(0, 200);
    }
  } catch {
    return `HTTP ${response.status}`;
  }
};

const refreshTidalToken = async (auth: TidalAuthState): Promise<TidalAuthState> => {
  if (!auth.refreshToken || !auth.clientId) throw new Error("TIDAL token 无法自动刷新");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: auth.refreshToken,
    client_id: auth.clientId,
  });
  const clientSecret = process.env.TIDAL_CLIENT_SECRET?.trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${auth.clientId}:${clientSecret}`).toString("base64")}`;
  }
  const response = await fetch(`${TIDAL_AUTH_BASE}/token`, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const message = await readErrorBody(response);
    if (response.status === 401 || response.status === 403) clearTidalAuth();
    throw new Error(`TIDAL token 刷新失败: ${message}`);
  }
  const token = (await response.json()) as TidalTokenResponse;
  if (!token.access_token) throw new Error("TIDAL token 刷新响应缺少 access_token");
  const next: TidalAuthState = {
    ...auth,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || auth.refreshToken,
    expiresAt: Date.now() + Math.max(token.expires_in || 3600, 60) * 1000,
  };
  setTidalAuth(next);
  return next;
};

const currentAuth = async (): Promise<TidalAuthState> => {
  const auth = getTidalAuth();
  if (!auth?.accessToken) throw new Error("TIDAL 未登录");
  if (
    auth.expiresAt &&
    Date.now() >= auth.expiresAt - TIDAL_TOKEN_REFRESH_MARGIN_MS &&
    auth.refreshToken &&
    auth.clientId
  ) {
    return refreshTidalToken(auth);
  }
  return auth;
};

const requestOnce = async <T>(
  auth: TidalAuthState,
  endpoint: string,
  params: Record<string, string | number | boolean>,
): Promise<{ response: Response; data?: T }> => {
  const countryCode = auth.countryCode || TIDAL_DEFAULT_COUNTRY;
  const query = new URLSearchParams({ countryCode });
  for (const [key, value] of Object.entries(params)) query.set(key, String(value));
  const response = await fetch(`${TIDAL_API_BASE}${endpoint}?${query}`, {
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "User-Agent": TIDAL_USER_AGENT,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return { response };
  return { response, data: (await response.json()) as T };
};

/**
 * 调用 TIDAL v1 API；遇到 401/403 时最多刷新并重试一次。
 * @param endpoint - 形如 `/search` 的 API 路径
 * @param params - 查询参数
 * @returns JSON 响应
 */
export const tidalRequest = async <T>(
  endpoint: string,
  params: Record<string, string | number | boolean> = {},
): Promise<T> => {
  let auth = await currentAuth();
  let result = await requestOnce<T>(auth, endpoint, params);
  if (result.data !== undefined) return result.data;

  if (
    (result.response.status === 401 || result.response.status === 403) &&
    auth.refreshToken &&
    auth.clientId
  ) {
    auth = await refreshTidalToken(auth);
    result = await requestOnce<T>(auth, endpoint, params);
    if (result.data !== undefined) return result.data;
  }

  const message = await readErrorBody(result.response);
  throw new Error(`TIDAL API 请求失败 (${result.response.status}): ${message}`);
};
