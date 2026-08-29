import type { CacheCategory, CacheKind, CacheStat, CacheSwitchResult } from "@shared/types/cache";
import { request } from "./controlClient";

/** Desktop 与 Web 共用的 Core cache 管理 client；song-cache 播放内部操作不属于 Control API。 */
export const cacheClient = {
  getStats: (): Promise<CacheStat[]> => request<CacheStat[]>("/cache/stats"),
  clear: async (id: CacheCategory): Promise<void> => {
    await request("/cache/clear", { method: "POST", body: JSON.stringify({ id }) });
  },
  clearAllByKind: async (kind: CacheKind): Promise<void> => {
    await request("/cache/clear-all", { method: "POST", body: JSON.stringify({ kind }) });
  },
  getDir: async (): Promise<string> => (await request<{ dir: string }>("/cache/dir")).dir,
  setDir: (dir: string): Promise<CacheSwitchResult> =>
    request<CacheSwitchResult>("/cache/dir", {
      method: "POST",
      body: JSON.stringify({ dir }),
    }),
  resetDir: async (): Promise<string> =>
    (await request<{ dir: string }>("/cache/reset-dir", { method: "POST" })).dir,
};
