import { getQobuzAuth } from "./auth";
import { QOBUZ_API_BASE } from "./config";
import { getQobuzAppCredentials } from "./credentials";
import { buildQobuzSignature } from "./signature";

export interface QobuzRequestOptions {
  signed?: boolean;
  authRequired?: boolean;
  /** 用于首次 token 校验等尚未持久化登录态的调用。 */
  authToken?: string;
}

interface QobuzErrorBody {
  status?: string;
  message?: string;
  reason?: string;
}

let workingSecret: string | null = null;

const isSignatureError = (message: string): boolean =>
  /signature|request_sig|secret/i.test(message);

const requestOnce = async <T>(
  endpoint: string,
  params: Record<string, string | number>,
  appId: string,
  token: string,
  secret?: string,
): Promise<T> => {
  const query: Record<string, string> = {
    app_id: appId,
    ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
  };
  if (token) query.user_auth_token = token;

  if (secret) {
    const timestamp = Math.floor(Date.now() / 1000);
    query.request_ts = String(timestamp);
    query.request_sig = buildQobuzSignature(endpoint, params, timestamp, secret);
  }

  const response = await fetch(`${QOBUZ_API_BASE}/${endpoint}?${new URLSearchParams(query)}`, {
    headers: {
      Accept: "application/json",
      "X-App-Id": appId,
      ...(token ? { "X-User-Auth-Token": token } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json()) as T & QobuzErrorBody;
  if (!response.ok || body.status === "error") {
    throw new Error(body.message || body.reason || `Qobuz API 请求失败: HTTP ${response.status}`);
  }
  return body;
};

/**
 * 调用 Qobuz v0.2 API。
 * 签名调用会按 qobuz-dl 验证过的候选 secret 顺序尝试；成功的 secret 仅在当前进程缓存。
 */
export const qobuzRequest = async <T>(
  endpoint: string,
  params: Record<string, string | number> = {},
  options: QobuzRequestOptions = {},
): Promise<T> => {
  const { signed = false, authRequired = true, authToken = "" } = options;
  const credentials = await getQobuzAppCredentials();
  const auth = getQobuzAuth();
  const token = authToken.trim() || auth?.token || "";
  if (authRequired && !token) throw new Error("Qobuz 未登录");

  if (!signed) {
    return requestOnce(endpoint, params, credentials.appId, token);
  }

  const candidates = [
    ...(workingSecret && credentials.secrets.includes(workingSecret) ? [workingSecret] : []),
    ...credentials.secrets.filter((secret) => secret !== workingSecret),
  ];
  let lastError: Error | null = null;
  for (const secret of candidates) {
    try {
      const result = await requestOnce<T>(endpoint, params, credentials.appId, token, secret);
      workingSecret = secret;
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;
      if (!isSignatureError(err.message)) throw err;
    }
  }
  throw lastError ?? new Error("Qobuz 没有可用的签名 secret");
};
