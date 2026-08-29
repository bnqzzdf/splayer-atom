import { dialog, ipcMain } from "electron";
import {
  clearCacheByKind,
  clearCacheCategory,
  getCacheDir,
  getCacheStats,
  resetCacheDir,
  switchCacheDir,
  type CacheCategory,
  type CacheKind,
} from "@main/services/cache";
import * as songCache from "@main/services/songCache";
import type { TrackSource } from "@shared/types/player";

export type { CacheCategory, CacheKind, CacheStat } from "@main/services/cache";

/** 注册缓存相关 IPC。 */
export const registerCacheIpc = (): void => {
  ipcMain.handle("cache:getStats", () => getCacheStats());
  ipcMain.handle("cache:clear", (_event, id: CacheCategory) => clearCacheCategory(id));
  ipcMain.handle("cache:clearAllByKind", (_event, kind: CacheKind) => clearCacheByKind(kind));
  ipcMain.handle("cache:getDir", () => getCacheDir());

  ipcMain.handle("cache:pickDir", async () => {
    const current = getCacheDir();
    const result = await dialog.showOpenDialog({
      title: "选择缓存目录",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, dir: current, reason: "canceled" as const };
    }
    return switchCacheDir(result.filePaths[0]);
  });

  ipcMain.handle("cache:resetDir", () => resetCacheDir());

  ipcMain.handle("cache:song:lookup", (_event, cacheKey: string): Promise<string | null> =>
    songCache.lookup(cacheKey),
  );
  ipcMain.handle(
    "cache:song:fetch",
    (_event, cacheKey: string, source: TrackSource, streamUrl: string): Promise<string | null> =>
      songCache.fetchAsync(cacheKey, source, streamUrl),
  );
  ipcMain.handle("cache:song:cancel", (_event, cacheKey: string): void => {
    songCache.cancel(cacheKey);
  });
};
