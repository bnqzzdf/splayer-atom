/**
 * QM 主进程服务
 *
 * 搜索可匿名使用；扫码或 Cookie 登录态由 Core 持久化，播放直链由 Core 原生模块解析。
 * 插件仅作为播放解析失败时的兜底。
 *
 * 统一入口：callQQMusic(name, params)
 */

import { createHash } from "node:crypto";
import { modules } from "./modules";
import {
  clearQQMusicCookies as clearRequestCookies,
  getQQMusicCookies,
  getQQMusicUin,
  mergeQQMusicCookies as mergeRequestCookies,
} from "./core/request";
import type { QMParams } from "./core/types";

export { getQQMusicCookies, getQQMusicUin };

/** 2 分钟响应缓存 */
const DEFAULT_TTL = 2 * 60 * 1000;
const MAX_ENTRIES = 200;

interface CacheEntry {
  value: unknown;
  expireAt: number;
}

const cache = new Map<string, CacheEntry>();

export const mergeQQMusicCookies = (cookies: Record<string, string>): void => {
  mergeRequestCookies(cookies);
  cache.clear();
};

export const clearQQMusicCookies = (): void => {
  clearRequestCookies();
  cache.clear();
};

/** 不缓存的实时接口 */
const NON_CACHEABLE: ReadonlySet<string> = new Set([
  "user_detail",
  "song_url",
  "comment",
  "login_qr_key",
  "login_qr_check",
]);

const hashParams = (params: unknown): string =>
  createHash("md5")
    .update(JSON.stringify(params ?? {}))
    .digest("hex")
    .slice(0, 8);

const cacheGet = (key: string): unknown => {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expireAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
};

const cacheSet = (key: string, value: unknown, ttl = DEFAULT_TTL): void => {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expireAt: Date.now() + ttl });
};

const isUncacheableResult = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.code === "number" && v.code !== 200) return true;
  if (Array.isArray(v.songs) && v.songs.length === 0) return true;
  if (Array.isArray(v.albums) && v.albums.length === 0) return true;
  if (Array.isArray(v.artists) && v.artists.length === 0) return true;
  if (Array.isArray(v.playlists) && v.playlists.length === 0) return true;
  return false;
};

/**
 * 调用任意 QM API
 * @param name  见 modules/index.ts 中的 key
 * @param params 业务参数；不想命中缓存可传 `timestamp: Date.now()`
 */
export const callQQMusic = async (name: string, params: QMParams = {}): Promise<any> => {
  // hasOwn 守卫
  const fn = Object.hasOwn(modules, name) ? modules[name] : undefined;
  if (!fn) throw new Error(`unknown qm api: ${name}`);

  if (NON_CACHEABLE.has(name)) return fn(params);

  const key = `${name}|${hashParams(params)}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;

  const value = await fn(params);
  if (!isUncacheableResult(value)) cacheSet(key, value);
  return value;
};
