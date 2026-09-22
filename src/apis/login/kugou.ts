/**
 * KG（酷狗音乐）账号适配器
 *
 * 后端实现位于 core/apis/kugou；扫码成功后由 Core 写入 account_sessions，
 * 登录态通过 /providers/sessions 投影回渲染层。
 */

import type { PlatformProfile } from "@shared/types/platform";
import { providerClient } from "@/core/providerClient";
import type { QrLoginAdapter, QrLoginState } from "./platform";

interface KgUserDetailResponse {
  code?: number;
  loggedIn?: boolean;
  profile?: PlatformProfile;
}

interface KgQrKeyResponse {
  code?: number;
  key?: string;
  content?: string;
}

interface KgQrCheckResponse {
  code?: number;
  status?: number;
  nickname?: string;
  avatarUrl?: string;
}

/** 统一调用 Core provider 接口，失败时抛出可读错误。 */
const callKg = async <T>(name: string, params: Record<string, unknown> = {}): Promise<T> => {
  const res = await providerClient.call("kugou", name, params);
  if (!res.ok) throw new Error(res.error);
  return res.data as T;
};

/** KG 扫码登录适配器（后端 login_qr_key 返回的是待渲染的 URL 内容） */
export const kugouQrLoginAdapter: QrLoginAdapter = {
  create: async () => {
    const res = await callKg<KgQrKeyResponse>("login_qr_key");
    if (!res?.key || !res?.content) throw new Error("kg qr key missing");
    return { key: res.key, content: res.content };
  },
  check: async (key: string) => {
    const res = await callKg<KgQrCheckResponse>("login_qr_check", { key });
    // KG 状态语义：4 = 已确认（成功后端已落库 token/userid）。
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
};

/**
 * 获取当前 KG 登录状态与用户资料
 * @returns 已登录返回 profile，未登录返回 null
 */
export const fetchKugouLoginStatus = async (): Promise<PlatformProfile | null> => {
  try {
    const data = await callKg<KgUserDetailResponse>("user_detail");
    if (data?.code === 200 && data.loggedIn && data.profile) return data.profile;
    return null;
  } catch (err) {
    console.warn("[kugou] fetch login status failed:", err);
    return null;
  }
};

/** 清除 KG 登录会话（登出，保留设备标识） */
export const logoutKugou = async (): Promise<void> => {
  await providerClient.clearSession("kugou");
};

/** 手动设置 KG Cookie */
export const setKugouCookie = async (cookieString: string): Promise<boolean> => {
  const res = await providerClient.setCookie("kugou", cookieString);
  return res.ok;
};
