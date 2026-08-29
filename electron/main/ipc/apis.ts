/**
 * 音源 API 统一 IPC
 *
 * 只注册两个通道：
 * - apis:call(platform, name, params)   调用对应平台的任意接口
 * - apis:clearSession(platform)         清空某平台登录态
 */

import { ipcMain } from "electron";
import { mergeNeteaseCookies } from "@main/apis/netease";
import { mergeQQMusicCookies } from "@main/apis/qqmusic";
import { openNeteaseLoginWindow, openQQMusicLoginWindow } from "@main/window/login";
import { coreLog } from "@main/utils/logger";
import {
  callProviderApi,
  clearProviderSession,
  getProviderSessions,
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

  ipcMain.handle("apis:clearSession", (_evt, platform: ApiPlatform) =>
    clearProviderSession(platform),
  );
  ipcMain.handle("apis:getSessions", () => getProviderSessions());

  // 打开官方网页登录，成功后把 cookies 合并写入 session
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

  // 手动写入 cookie 登录
  ipcMain.handle("apis:setCookie", (_evt, platform: ApiPlatform, raw: string) =>
    setProviderCookie(platform, raw),
  );
};
