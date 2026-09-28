import type { Platform, PlatformProfile } from "@shared/types/platform";
import { providerClient } from "@/core/providerClient";
import {
  fetchQQMusicLoginStatus,
  logoutQQMusic,
  qqmusicQrLoginAdapter,
  qqmusicWxQrLoginAdapter,
  setQQMusicCookie,
} from "./qqmusic";
import { fetchKugouLoginStatus, kugouQrLoginAdapter, logoutKugou, setKugouCookie } from "./kugou";
import { fetchQobuzLoginStatus, logoutQobuz } from "./qobuz";
import { fetchTidalLoginStatus, logoutTidal } from "./tidal";
import {
  fetchLoginStatus as fetchNeteaseLoginStatus,
  logoutNeteaseAccount,
  neteaseQrLoginAdapter,
} from "./netease";

export type QrLoginState = "expired" | "waiting" | "scanned" | "success";

export interface QrLoginAdapter {
  create: () => Promise<{ key: string; content: string }>;
  check: (key: string) => Promise<{
    state: QrLoginState;
    nickname?: string;
    avatarUrl?: string;
  }>;
}

export interface QrLoginOption {
  key: string;
  labelKey: string;
  adapter: QrLoginAdapter;
}

export interface PlatformAccountAdapter {
  displayName: string;
  userIdLabel: string;
  fetchProfile: () => Promise<PlatformProfile | null>;
  logout: () => Promise<void>;
  openWebLogin?: () => Promise<boolean>;
  setCookie?: (cookie: string) => Promise<boolean>;
  qrLogin?: QrLoginAdapter;
  qrLoginOptions?: QrLoginOption[];
}

const adapters: Partial<Record<Platform, PlatformAccountAdapter>> = {
  netease: {
    displayName: "NCM",
    userIdLabel: "UID",
    /**
     * 网易的 profile 来自 `login_status`（同一份数据也让 user store 用）。
     * 匿名游客会话在那里会被判成未登录，所以这里可以直接信 null。
     */
    fetchProfile: async () => {
      const profile = await fetchNeteaseLoginStatus();
      if (!profile) return null;
      return {
        userId: String(profile.userId),
        nickname: profile.nickname,
        avatarUrl: profile.avatarUrl ?? "",
        // 0 = 普通用户，非 0 = 黑胶 VIP
        isVip: Boolean(profile.vipType && profile.vipType !== 0),
      };
    },
    logout: logoutNeteaseAccount,
    setCookie: async (cookie) => (await providerClient.setCookie("netease", cookie)).ok,
    qrLogin: neteaseQrLoginAdapter,
  },
  qqmusic: {
    displayName: "QM",
    userIdLabel: "UIN",
    fetchProfile: fetchQQMusicLoginStatus,
    logout: logoutQQMusic,
    setCookie: setQQMusicCookie,
    qrLogin: qqmusicQrLoginAdapter,
    qrLoginOptions: [
      {
        key: "qq",
        labelKey: "settings.platformLogin.loginQrQQ",
        adapter: qqmusicQrLoginAdapter,
      },
      {
        key: "wx",
        labelKey: "settings.platformLogin.loginQrWX",
        adapter: qqmusicWxQrLoginAdapter,
      },
    ],
  },
  kugou: {
    displayName: "KG",
    userIdLabel: "ID",
    fetchProfile: fetchKugouLoginStatus,
    logout: logoutKugou,
    setCookie: setKugouCookie,
    qrLogin: kugouQrLoginAdapter,
  },
  qobuz: {
    displayName: "Qobuz",
    userIdLabel: "ID",
    fetchProfile: fetchQobuzLoginStatus,
    logout: logoutQobuz,
  },
  tidal: {
    displayName: "TIDAL",
    userIdLabel: "ID",
    fetchProfile: fetchTidalLoginStatus,
    logout: logoutTidal,
  },
};

/**
 * 获取平台账号适配器
 * @param platform - 音乐平台
 * @returns 平台账号适配器
 */
export const getPlatformAccountAdapter = (platform: Platform): PlatformAccountAdapter => {
  const adapter = adapters[platform];
  if (!adapter) throw new Error(`平台暂不支持账号连接: ${platform}`);
  return adapter;
};
