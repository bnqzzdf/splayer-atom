import { callNetease } from "@main/apis/netease";
import { playerLog } from "@main/utils/logger";
import type { PersonalFmOptions } from "@shared/types/personalFm";
import type { Track } from "@shared/types/player";
import { neteaseSongsToTracks, type NeteaseTrackSource } from "@shared/utils/neteaseTrack";

const FM_PREFETCH_AHEAD = 1;

let pool: Track[] = [];
let fetchingPromise: Promise<void> | null = null;
let currentOptions: PersonalFmOptions | undefined;

const fetchMore = (): Promise<void> => {
  if (fetchingPromise) return fetchingPromise;
  fetchingPromise = (async () => {
    try {
      const response = await callNetease("personal_fm", {
        ...(currentOptions?.mode ? { mode: currentOptions.mode } : {}),
        ...(currentOptions?.submode ? { submode: currentOptions.submode } : {}),
        ...(currentOptions?.limit ? { limit: currentOptions.limit } : {}),
      });
      const songs = (response.body as { data?: NeteaseTrackSource[] } | undefined)?.data ?? [];
      const seen = new Set(pool.map((track) => track.id));
      const fresh = neteaseSongsToTracks(songs).filter((track) => !seen.has(track.id));
      if (fresh.length > 0) pool = [...pool, ...fresh];
    } catch (error) {
      playerLog.warn(`[fm] recommendation fetch failed: ${String(error)}`);
    } finally {
      fetchingPromise = null;
    }
  })();
  return fetchingPromise;
};

const ensureAhead = async (): Promise<void> => {
  if (pool.length > FM_PREFETCH_AHEAD) return;
  await fetchMore();
};

export const getPersonalFmPool = (): Track[] => pool.map((track) => ({ ...track }));
export const getPersonalFmOptions = (): PersonalFmOptions | undefined =>
  currentOptions ? { ...currentOptions } : undefined;

/** Core 跳过/选择 FM 预取项后，把 provider pool 对齐到实际成功播放的 canonical Track。 */
export const alignPersonalFmPool = (currentIndex: number): Track[] => {
  if (currentIndex > 0) pool = pool.slice(currentIndex);
  return getPersonalFmPool();
};

export const startPersonalFmPool = async (options?: PersonalFmOptions): Promise<Track[]> => {
  const changed =
    options?.mode !== currentOptions?.mode || options?.submode !== currentOptions?.submode;
  if (changed) {
    currentOptions = options ? { ...options } : undefined;
    pool = [];
  }
  if (pool.length === 0) await fetchMore();
  await ensureAhead();
  return getPersonalFmPool();
};

export const advancePersonalFmPool = async (): Promise<Track[]> => {
  if (pool.length > 0) pool = pool.slice(1);
  await ensureAhead();
  return getPersonalFmPool();
};

export const dislikePersonalFmCurrent = async (playedSec?: number): Promise<Track[]> => {
  const current = pool[0];
  if (current) {
    void callNetease("fm_trash", {
      id: current.id,
      ...(playedSec !== undefined ? { time: Math.max(0, Math.round(playedSec)) } : {}),
    }).catch((error) => playerLog.warn(`[fm] trash feedback failed: ${String(error)}`));
  }
  return advancePersonalFmPool();
};

export const resetPersonalFmPool = (): void => {
  pool = [];
  currentOptions = undefined;
};
