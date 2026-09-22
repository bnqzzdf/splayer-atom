import path from "node:path";
import fs from "node:fs/promises";
import { existsSync, type Dirent } from "node:fs";
import { store } from "@main/store";
import {
  getAppCacheDir,
  getCoverCacheDir,
  getArtistCacheDir,
  getBackgroundsDir,
  getSongCacheDir,
} from "@main/utils/config";
import { syncCoverCacheDir } from "@main/services/engine";
import { getDb } from "@main/database";
import { clearLyricCache } from "@main/database/lyricCache";
import { clearLyricTtmlCache } from "@main/database/lyricTtmlCache";
import { clearLyricMatchCache } from "@main/database/lyricMatchCache";
import * as songCache from "@main/services/songCache";
import { systemLog } from "@main/utils/logger";
import { defaultCacheDir } from "@main/utils/paths";
import type { CacheCategory, CacheKind, CacheStat, CacheSwitchResult } from "@shared/types/cache";

export type { CacheCategory, CacheKind, CacheStat } from "@shared/types/cache";

/**
 * 递归累计目录占用。
 * @param dir - 目录路径
 * @returns 占用字节数
 */
const dirSize = async (dir: string): Promise<number> => {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) return await dirSize(full);
        if (entry.isFile()) return (await fs.stat(full)).size;
      } catch {}
      return 0;
    }),
  );
  return sizes.reduce((sum, item) => sum + item, 0);
};

/** 清空目录但保留目录本身。 */
const clearDir = async (dir: string): Promise<void> => {
  if (!existsSync(dir)) return;
  const entries = await fs.readdir(dir);
  await Promise.all(
    entries.map((name) => fs.rm(path.join(dir, name), { recursive: true, force: true })),
  );
};

/** 目录是否为空；不存在视为空。 */
const isDirEmpty = async (dir: string): Promise<boolean> => {
  if (!existsSync(dir)) return true;
  return (await fs.readdir(dir)).length === 0;
};

/** sqlite 单表占用：取指定 TEXT/BLOB 字段 length 之和。 */
const tableSize = (table: string, columns: string[]): number => {
  try {
    const expr = columns.map((column) => `COALESCE(length(${column}), 0)`).join(" + ");
    const row = getDb().prepare(`SELECT SUM(${expr}) AS total FROM ${table}`).get() as
      { total: number | null } | undefined;
    return row?.total ?? 0;
  } catch {
    return 0;
  }
};

const categoryHandlers: Record<
  CacheCategory,
  {
    kind: CacheKind;
    path: () => string;
    size: () => number | Promise<number>;
    clear: () => void | Promise<void>;
  }
> = {
  covers: {
    kind: "file",
    path: getCoverCacheDir,
    size: () => dirSize(getCoverCacheDir()),
    clear: () => clearDir(getCoverCacheDir()),
  },
  artists: {
    kind: "file",
    path: getArtistCacheDir,
    size: () => dirSize(getArtistCacheDir()),
    clear: () => clearDir(getArtistCacheDir()),
  },
  backgrounds: {
    kind: "file",
    path: getBackgroundsDir,
    size: () => dirSize(getBackgroundsDir()),
    clear: () => clearDir(getBackgroundsDir()),
  },
  songs: {
    kind: "file",
    path: getSongCacheDir,
    size: () => songCache.stats().size,
    clear: () => songCache.clearAll(),
  },
  lyric: {
    kind: "db",
    path: () => "lyric_cache",
    size: () => tableSize("lyric_cache", ["data"]),
    clear: clearLyricCache,
  },
  lyricTTML: {
    kind: "db",
    path: () => "lyric_ttml_cache",
    size: () => tableSize("lyric_ttml_cache", ["content"]),
    clear: clearLyricTtmlCache,
  },
  lyricMatch: {
    kind: "db",
    path: () => "lyric_match_cache",
    size: () => tableSize("lyric_match_cache", ["fingerprint", "platform_id", "extra"]),
    clear: clearLyricMatchCache,
  },
};

const idsByKind = (kind: CacheKind): CacheCategory[] =>
  (Object.keys(categoryHandlers) as CacheCategory[]).filter(
    (id) => categoryHandlers[id].kind === kind,
  );

/** 返回全部 Core cache 占用快照。 */
export const getCacheStats = async (): Promise<CacheStat[]> => {
  const ids = Object.keys(categoryHandlers) as CacheCategory[];
  return Promise.all(
    ids.map(async (id) => ({
      id,
      kind: categoryHandlers[id].kind,
      path: categoryHandlers[id].path(),
      size: await categoryHandlers[id].size(),
    })),
  );
};

/** 清理一个已知 cache 类别。 */
export const clearCacheCategory = async (id: CacheCategory): Promise<void> => {
  const handler = categoryHandlers[id];
  if (!handler) return;
  try {
    await handler.clear();
    systemLog.info(`[cache] cleared ${id}`);
  } catch (error) {
    systemLog.error(`[cache] clear ${id} failed`, error);
    throw error;
  }
};

/** 按 file/db 介质清理全部对应 cache。 */
export const clearCacheByKind = async (kind: CacheKind): Promise<void> => {
  await Promise.all(idsByKind(kind).map((id) => categoryHandlers[id].clear()));
  systemLog.info(`[cache] cleared all (${kind})`);
};

/** 返回 Core 当前 cache 根目录。 */
export const getCacheDir = (): string => getAppCacheDir();

/**
 * 切换 Core cache 根目录；调用方负责取得 Core 主机上的真实目录路径。
 * @param next - Core 主机上的目标目录
 */
export const switchCacheDir = async (next: string): Promise<CacheSwitchResult> => {
  const current = getAppCacheDir();
  if (!(await isDirEmpty(next))) return { ok: false, dir: current, reason: "notEmpty" };
  await Promise.all(idsByKind("file").map((id) => categoryHandlers[id].clear()));
  store.set("cache.dir", next);
  syncCoverCacheDir();
  songCache.reloadDir();
  systemLog.info(`[cache] dir switched to ${next}`);
  return { ok: true, dir: next };
};

/** 还原 Core 默认 cache 根目录。 */
export const resetCacheDir = async (): Promise<string> => {
  await Promise.all(idsByKind("file").map((id) => categoryHandlers[id].clear()));
  store.set("cache.dir", null);
  syncCoverCacheDir();
  songCache.reloadDir();
  return defaultCacheDir;
};
