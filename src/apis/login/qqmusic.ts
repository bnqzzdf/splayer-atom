/**
 * QM（QQ 音乐）账号适配器
 *
 * 后端实现位于 core/apis/qqmusic，登录态由 Core 通过 /providers/* 统一投影；
 * 渲染层只持有 adapter，不接触任何 cookie/凭据。
 */

import type { PlatformProfile } from "@shared/types/platform";
import { providerClient } from "@/core/providerClient";
import type { QrLoginAdapter, QrLoginState } from "./platform";

interface QmUserDetailResponse {
  code?: number;
  loggedIn?: boolean;
  profile?: PlatformProfile;
}

interface QmQrKeyResponse {
  code?: number;
  key?: string;
  content?: string;
  type?: string;
}

interface QmQrCheckResponse {
  code?: number;
  status?: number;
  nickname?: string;
  avatarUrl?: string;
}

/** 统一调用 Core provider 接口，失败时抛出可读错误。 */
const callQm = async <T>(name: string, params: Record<string, unknown> = {}): Promise<T> => {
  const res = await providerClient.call("qqmusic", name, params);
  if (!res.ok) throw new Error(res.error);
  return res.data as T;
};

/**
 * 创建 QM 扫码适配器
 * @param type 扫码类型，'qq' 或 'wx'
 */
const createQmQrAdapter = (type: "qq" | "wx"): QrLoginAdapter => ({
  create: async () => {
    const res = await callQm<QmQrKeyResponse>("login_qr_key", { type });
    if (!res?.key || !res?.content) throw new Error("qm qr key missing");
    // QQ 返回 data:image/png 直出；微信同样返回 data:image/jpeg。
    return { key: res.key, content: res.content };
  },
  check: async (key: string) => {
    const res = await callQm<QmQrCheckResponse>("login_qr_check", { key, type });
    const state: QrLoginState =
      res.status === 0
        ? "expired"
        : res.status === 2
          ? "scanned"
          : res.status === 4
            ? "success"
            : "waiting";
    return { state, nickname: res.nickname, avatarUrl: res.avatarUrl };
  },
});

/** QQ 扫码登录适配器 */
export const qqmusicQrLoginAdapter: QrLoginAdapter = createQmQrAdapter("qq");

/** 微信扫码登录适配器 */
export const qqmusicWxQrLoginAdapter: QrLoginAdapter = createQmQrAdapter("wx");

/**
 * 获取当前 QM 登录状态与用户资料
 * @returns 已登录返回 profile，未登录返回 null
 */
export const fetchQQMusicLoginStatus = async (): Promise<PlatformProfile | null> => {
  try {
    const data = await callQm<QmUserDetailResponse>("user_detail");
    if (data?.code === 200 && data.loggedIn && data.profile) return data.profile;
    return null;
  } catch (err) {
    console.warn("[qqmusic] fetch login status failed:", err);
    return null;
  }
};

/** 清除 QM 登录会话（登出） */
export const logoutQQMusic = async (): Promise<void> => {
  await providerClient.clearSession("qqmusic");
};

/** 手动设置 QM Cookie */
export const setQQMusicCookie = async (cookieString: string): Promise<boolean> => {
  const res = await providerClient.setCookie("qqmusic", cookieString);
  return res.ok;
};
