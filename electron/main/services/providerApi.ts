/**
 * 在线平台 API 共享主进程服务。
 * Electron IPC 与 Headless HTTP 都只能从这里进入，避免复制 provider 业务逻辑。
 */

import { callNetease, clearNeteaseCookies, mergeNeteaseCookies } from "@main/apis/netease";
import { NeteaseRequestError } from "@main/apis/netease/core/request";
import { cookieToJson } from "@main/apis/netease/core/cookie";
import { callQQMusic, clearQQMusicCookies, mergeQQMusicCookies } from "@main/apis/qqmusic";
import { callKugou, clearKugouSession, mergeKugouSession } from "@main/apis/kugou";
import { callQobuz } from "@main/apis/qobuz";
import { callTidal } from "@main/apis/tidal";
import { coreLog } from "@main/utils/logger";
import type { ApiCallResponse, ApiPlatform } from "@shared/types/apis";

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
    return { ok: true, ...(await dispatch(platform, name, params)) };
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
    return { ok: true };
  }
  if (platform === "qqmusic") {
    if (!parsed.uin && !parsed.wxuin && !parsed.p_uin && !parsed.qm_keyst && !parsed.qqmusic_key) {
      return { ok: false, error: "missing uin or key" };
    }
    mergeQQMusicCookies(parsed);
    return { ok: true };
  }
  if (platform === "kugou") {
    if (!parsed.token || !parsed.userid) return { ok: false, error: "missing token or userid" };
    mergeKugouSession(parsed);
    return { ok: true };
  }
  return { ok: false, error: "unsupported platform" };
};
