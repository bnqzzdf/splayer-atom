import * as netease from "@main/apis/common/lyric/netease";
import * as qqmusic from "@main/apis/common/lyric/qqmusic";
import * as kugou from "@main/apis/common/lyric/kugou";
import { fetchTTML } from "@main/apis/common/lyric/ttml";
import { matchLocalTTML } from "@main/services/localLyricRepo";
import { buildFingerprint, getMatchedId } from "@main/database/lyricMatchCache";
import { coreLog } from "@main/utils/logger";
import type { LyricMatchResponse, LyricTTMLResponse } from "@shared/types/lyrics";
import type { Platform } from "@shared/types/platform";
import type { Track } from "@shared/types/player";

const inflight = new Map<string, Promise<unknown>>();

const dedup = <T>(key: string, run: () => Promise<T>): Promise<T> => {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = run().finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
};

/** 按平台 ID 获取歌词。 */
export const matchLyricById = (platform: Platform, id: string): Promise<LyricMatchResponse> =>
  dedup(`byId:${platform}:${id}`, async () => {
    try {
      switch (platform) {
        case "netease":
          return { ok: true, data: await netease.getByPlatformId(id) };
        case "qqmusic":
          return { ok: true, data: await qqmusic.getByPlatformId(id) };
        case "kugou":
          return { ok: true, data: await kugou.getByPlatformId(id) };
        default:
          return { ok: false, error: `unsupported platform: ${platform}` };
      }
    } catch (error) {
      coreLog.warn(`[lyrics] matchById(${platform}, ${id}) failed:`, error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

/** 按 Track 元数据模糊匹配歌词。 */
export const matchLyricByQuery = (platform: Platform, track: Track): Promise<LyricMatchResponse> =>
  dedup(`byQuery:${platform}:${track.id}`, async () => {
    try {
      switch (platform) {
        case "netease":
          return { ok: true, data: await netease.getByQuery(track) };
        case "qqmusic":
          return { ok: true, data: await qqmusic.getByQuery(track) };
        case "kugou":
          return { ok: true, data: await kugou.getByQuery(track) };
        default:
          return { ok: false, error: `unsupported platform: ${platform}` };
      }
    } catch (error) {
      coreLog.warn(`[lyrics] matchByQuery(${platform}, ${track.title}) failed:`, error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

/** 按 Track 与平台查找 AMLL TTML overlay。 */
export const fetchLyricTTMLOverlay = (
  track: Track,
  platform: "netease" | "qqmusic",
): Promise<LyricTTMLResponse> =>
  dedup(`ttml:${platform}:${track.id}`, async () => {
    try {
      const ids: string[] = [];
      const push = (value?: string): void => {
        if (value && !ids.includes(value)) ids.push(value);
      };
      const fingerprint = buildFingerprint(track);
      const cached = getMatchedId(fingerprint, platform);
      if (platform === "qqmusic") push(cached?.extra?.mid);
      if (track.source === platform) push(track.id);
      if (track.source === platform) push(track.extId);
      push(cached?.platformId);
      if (ids.length === 0) return { ok: true, data: null };
      return { ok: true, data: await fetchTTML(platform, ids) };
    } catch (error) {
      coreLog.warn(`[lyrics] fetchTTMLOverlay(${platform}, ${track.title}) failed:`, error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

/** 匹配 Core 本机 TTML 歌词库。 */
export const matchCoreLocalTTML = async (track: Track): Promise<LyricTTMLResponse> => {
  try {
    return { ok: true, data: await matchLocalTTML(track) };
  } catch (error) {
    coreLog.warn(`[lyrics] matchLocalTTML(${track.title}) failed:`, error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};
