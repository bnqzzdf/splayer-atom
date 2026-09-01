/**
 * QQ / 酷狗 legacy 登录态兼容 Store。
 *
 * 两个平台在 Atom 产品面已冻结，不进入正式 Provider Core Domain；保留这里仅用于上游兼容代码。
 * Qobuz / TIDAL 的凭据由 Core 持久化，Control 只读取 `providerSessions` 投影。
 */

import { defineStore } from "pinia";
import { fetchQQMusicLoginStatus, logoutQQMusic as doLogoutQQMusic } from "@/apis/login/qqmusic";
import { fetchKugouLoginStatus, logoutKugou as doLogoutKugou } from "@/apis/login/kugou";

interface QQMusicAuthInfo {
  loggedIn: boolean;
  uin?: string;
}

interface KugouAuthInfo {
  loggedIn: boolean;
}

interface LegacyStreamingAuthState {
  qqmusic: QQMusicAuthInfo;
  kugou: KugouAuthInfo;
  initialized: boolean;
}

export const useStreamingAuthStore = defineStore("streamingAuth", {
  state: (): LegacyStreamingAuthState => ({
    qqmusic: { loggedIn: false },
    kugou: { loggedIn: false },
    initialized: false,
  }),

  getters: {
    qqmusicLoggedIn: (state) => state.qqmusic.loggedIn,
    kugouLoggedIn: (state) => state.kugou.loggedIn,
  },

  actions: {
    async fetchQQMusicStatus(): Promise<void> {
      try {
        const profile = await fetchQQMusicLoginStatus();
        this.qqmusic = {
          loggedIn: Boolean(profile),
          uin: profile?.userId,
        };
      } catch {
        this.qqmusic = { loggedIn: false };
      } finally {
        this.initialized = true;
      }
    },

    async logoutQQMusic(): Promise<void> {
      await doLogoutQQMusic();
      this.qqmusic = { loggedIn: false };
    },

    async fetchKugouStatus(): Promise<void> {
      try {
        this.kugou = { loggedIn: Boolean(await fetchKugouLoginStatus()) };
      } catch {
        this.kugou = { loggedIn: false };
      } finally {
        this.initialized = true;
      }
    },

    async logoutKugou(): Promise<void> {
      await doLogoutKugou();
      this.kugou = { loggedIn: false };
    },
  },
});
