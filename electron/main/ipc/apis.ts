/**
 * 音源 API 兼容 / Host IPC。
 *
 * Atom-managed Provider Core Domain 已走共享 Core Protocol；这里仅保留
 * QQ/酷狗 legacy call 与 Netease embedded-login Host capability。
 */

import { ipcMain } from "electron";
import { mergeNeteaseCookies } from "@main/apis/netease";
import { mergeQQMusicCookies } from "@main/apis/qqmusic";
import { openNeteaseLoginWindow, openQQMusicLoginWindow } from "@main/window/login";
import { coreLog } from "@main/utils/logger";
import {
  callProviderApi,
  clearProviderSession,
  publishProviderSessionsIfChanged,
  setProviderCookie,
} from "@main/services/providerApi";
import type { ApiPlatform } from "@shared/types/apis";

export const registerApisIpc = (): void => {
  ipcMain.handle(
    "apis:call",
    (_evt, platform: ApiPlatform, name: string, params?: Record<string, unknown>) =>
      callProviderApi(platform, name, params),
  );

  // QQ/酷狗仍是 legacy provider；Managed Provider 的 session 写入已走 Core Protocol。
  ipcMain.handle("apis:clearSession", (_evt, platform: ApiPlatform) => {
    if (platform !== "qqmusic" && platform !== "kugou") return;
    return clearProviderSession(platform);
  });
  ipcMain.handle("apis:setCookie", (_evt, platform: ApiPlatform, raw: string) => {
    if (platform !== "qqmusic" && platform !== "kugou") {
      return { ok: false, error: "unsupported platform" };
    }
    return setProviderCookie(platform, raw);
  });

  // 打开官方网页登录，成功后把 cookies 合并写入 session。
  ipcMain.handle("apis:openLoginWeb", async (_evt, platform: ApiPlatform) => {
    try {
      if (platform === "netease") {
        const cookies = await openNeteaseLoginWindow();
        if (!cookies) return { ok: false, error: "canceled" };
        mergeNeteaseCookies(cookies);
        publishProviderSessionsIfChanged();
        return { ok: true };
      }
      if (platform === "qqmusic") {
        const cookies = await openQQMusicLoginWindow();
        if (!cookies) return { ok: false, error: "canceled" };
        mergeQQMusicCookies(cookies);
        publishProviderSessionsIfChanged();
        return { ok: true };
      }
      return { ok: false, error: "unsupported platform" };
    } catch (err) {
      coreLog.warn(`[apis] openLoginWeb ${platform} failed:`, err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
};
