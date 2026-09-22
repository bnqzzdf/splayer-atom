/**
 * 在线平台 Core API 服务。
 * HTTP Control 与 Core 内部调用复用这里，避免复制 provider 业务逻辑。
 */

import {
  callNetease,
  clearNeteaseCookies,
  getNeteaseCookies,
  mergeNeteaseCookies,
} from "@main/apis/netease";
import { NeteaseRequestError } from "@main/apis/netease/core/request";
import { cookieToJson } from "@main/apis/netease/core/cookie";
import {
  callQQMusic,
  clearQQMusicCookies,
  getQQMusicCookies,
  getQQMusicUin,
  mergeQQMusicCookies,
} from "@main/apis/qqmusic";
import { callKugou, clearKugouSession, getKugouSession, mergeKugouSession } from "@main/apis/kugou";
import { callQobuz } from "@main/apis/qobuz";
import { getQobuzAuthStatus } from "@main/apis/qobuz/auth";
import { callTidal } from "@main/apis/tidal";
import { getTidalAuthStatus } from "@main/apis/tidal/auth";
import { publishCoreControlEvent } from "@main/services/coreControlEvents";
import { coreLog } from "@main/utils/logger";
import type { ApiCallResponse, ApiPlatform, ProviderSessionsSnapshot } from "@shared/types/apis";

let lastSessionProjection = "";

/** 读取 Core 当前持有的 provider session；任何 Control 都只投影这份状态。 */
export const getProviderSessions = (): ProviderSessionsSnapshot => {
  const qobuz = getQobuzAuthStatus();
  const tidal = getTidalAuthStatus();
  // QM：uin 与任一登录 key 同时存在才算已登录（与 user_detail 的判定保持一致）。
  const qmUin = getQQMusicUin();
  const qmCookies = getQQMusicCookies();
  const qmAuthenticated =
    Boolean(qmUin) &&
    qmUin !== "0" &&
    Boolean(
      qmCookies.qm_keyst ||
        qmCookies.qqmusic_key ||
        qmCookies.pskey ||
        qmCookies.p_skey ||
        qmCookies.skey,
    );
  // KG：token + userid 是扫码/或 Cookie 登录后落库的凭据。
  const kgSession = getKugouSession();
  const kgAuthenticated = Boolean(kgSession.token && kgSession.userid);
  return {
    netease: { authenticated: Boolean(getNeteaseCookies().MUSIC_U) },
    qqmusic: {
      authenticated: qmAuthenticated,
      ...(qmAuthenticated ? { userId: qmUin } : {}),
      ...(qmAuthenticated && qmCookies.nickname ? { username: qmCookies.nickname } : {}),
    },
    kugou: {
      authenticated: kgAuthenticated,
      ...(kgAuthenticated ? { userId: String(kgSession.userid) } : {}),
      ...(kgAuthenticated && kgSession.nickname ? { username: kgSession.nickname } : {}),
    },
    qobuz: {
      authenticated: qobuz.loggedIn,
      userId: qobuz.userId,
      username: qobuz.username,
    },
    tidal: {
      authenticated: tidal.loggedIn,
      userId: tidal.userId,
      username: tidal.username,
      countryCode: tidal.countryCode,
      expiresAt: tidal.expiresAt,
      refreshable: tidal.refreshable,
    },
  };
};

/** 仅在 session 投影实际变化时广播，避免普通 provider 查询制造事件噪声。 */
export const publishProviderSessionsIfChanged = (): void => {
  const snapshot = getProviderSessions();
  const serialized = JSON.stringify(snapshot);
  if (serialized === lastSessionProjection) return;
  lastSessionProjection = serialized;
  publishCoreControlEvent({ type: "providerSessions", data: snapshot });
};

/** 各平台的调用器：统一返回 renderer 既有响应结构。 */
const dispatch = async (
  platform: ApiPlatform,
  name: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  switch (platform) {
    case "netease": {
      try {
        const res = await callNetease(name, params);
        return { status: res.status, body: res.body };
      } catch (error) {
        // 网易匿名注册偶发首包不带 MUSIC_A；复用原注册接口重试一次，不在 Web 侧伪造 cookie。
        if (
          name !== "register_anonimous" &&
          String(error).includes("netease anonymous registration missing MUSIC_A")
        ) {
          const registration = await callNetease("register_anonimous");
          const rawCookie = (registration.body as { cookie?: unknown })?.cookie;
          if (typeof rawCookie === "string") {
            const parsed = cookieToJson(rawCookie);
            if (parsed.MUSIC_A) {
              mergeNeteaseCookies({
                MUSIC_A: parsed.MUSIC_A,
                ...(parsed.__csrf ? { __csrf: parsed.__csrf } : {}),
              });
            }
          }
          const res = await callNetease(name, params);
          return { status: res.status, body: res.body };
        }
        throw error;
      }
    }
    case "qqmusic":
      return { data: await callQQMusic(name, params) };
    case "kugou":
      return { data: await callKugou(name, params) };
    case "qobuz":
      return { data: await callQobuz(name, params) };
    case "tidal":
      return { data: await callTidal(name, params) };
  }
};

export const callProviderApi = async (
  platform: ApiPlatform,
  name: string,
  params: Record<string, unknown> = {},
): Promise<ApiCallResponse> => {
  try {
    const response = { ok: true as const, ...(await dispatch(platform, name, params)) };
    publishProviderSessionsIfChanged();
    return response;
  } catch (error) {
    coreLog.warn(`[apis] ${platform}.${name} failed:`, error);
    if (platform === "netease" && error instanceof NeteaseRequestError) {
      return {
        ok: false,
        error: error.message,
        status: error.response.status,
        body: error.response.body,
      };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

export const clearProviderSession = async (platform: ApiPlatform): Promise<void> => {
  if (platform === "netease") clearNeteaseCookies();
  else if (platform === "qqmusic") clearQQMusicCookies();
  else if (platform === "kugou") clearKugouSession();
  else if (platform === "qobuz") await callQobuz("auth_logout");
  else if (platform === "tidal") await callTidal("auth_logout");
  publishProviderSessionsIfChanged();
};

/** 手动写入登录 Cookie / session。 */
export const setProviderCookie = (
  platform: ApiPlatform,
  raw: string,
): { ok: true } | { ok: false; error: string } => {
  const parsed = cookieToJson(raw);
  if (platform === "netease") {
    if (!parsed.MUSIC_U) return { ok: false, error: "missing MUSIC_U" };
    mergeNeteaseCookies(parsed);
    publishProviderSessionsIfChanged();
    return { ok: true };
  }
  if (platform === "qqmusic") {
    if (!parsed.uin && !parsed.wxuin && !parsed.p_uin && !parsed.qm_keyst && !parsed.qqmusic_key) {
      return { ok: false, error: "missing uin or key" };
    }
    mergeQQMusicCookies(parsed);
    publishProviderSessionsIfChanged();
    return { ok: true };
  }
  if (platform === "kugou") {
    if (!parsed.token || !parsed.userid) return { ok: false, error: "missing token or userid" };
    mergeKugouSession(parsed);
    publishProviderSessionsIfChanged();
    return { ok: true };
  }
  return { ok: false, error: "unsupported platform" };
};
