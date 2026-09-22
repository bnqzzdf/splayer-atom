import type { Track } from "@shared/types/player";

export interface CueRange {
  startMs: number;
  durationMs: number;
  directRelative: boolean;
}

let activeCueRange: CueRange | null = null;

export interface DirectCueSegment {
  startFrame75: number;
  endFrame75?: number;
}

/**
 * 从 canonical Track 取得 Direct 使用的 CUE 75fps segment。
 *
 * 不允许从毫秒字段反推 start/end：旧持久化队列必须先回到 library canonical Track
 * 补齐 cueStartFrame75/cueEndFrame75。否则最后一轨的 cueEndMs（物理 EOF）无法与
 * “下一条 INDEX 01”可靠区分，Direct 不能据此做精确裁切。
 */
export const directCueSegmentFromTrack = (
  track: Track | null | undefined,
): DirectCueSegment | null => {
  if (track?.cueStartMs == null || track.cueEndMs == null) return null;
  const startFrame75 = track.cueStartFrame75;
  if (startFrame75 == null) return null;
  const endFrame75 = track.cueEndFrame75;
  if (!Number.isSafeInteger(startFrame75) || startFrame75 < 0) return null;
  if (endFrame75 != null && (!Number.isSafeInteger(endFrame75) || endFrame75 <= startFrame75)) {
    return null;
  }
  return { startFrame75, endFrame75 };
};

export const cueRangeFromTrack = (track: Track | null | undefined): CueRange | null => {
  const start = track?.cueStartMs;
  const end = track?.cueEndMs;
  if (start == null || end == null || end <= start) return null;
  return { startMs: start, durationMs: end - start, directRelative: false };
};

export const setActiveCueTrack = (
  track: Track | null | undefined,
  directRelative = false,
): CueRange | null => {
  const range = cueRangeFromTrack(track);
  activeCueRange = range ? { ...range, directRelative } : null;
  return activeCueRange;
};

export const clearActiveCueRange = (): void => {
  activeCueRange = null;
};

export const toDisplayPositionMs = (positionMs: number): number => {
  if (!activeCueRange) return positionMs;
  if (activeCueRange.directRelative) {
    return Math.max(0, Math.min(activeCueRange.durationMs, positionMs));
  }
  return Math.max(0, Math.min(activeCueRange.durationMs, positionMs - activeCueRange.startMs));
};

export const toDisplayDurationMs = (durationMs: number): number =>
  activeCueRange?.durationMs ?? durationMs;

export const toEnginePositionMs = (positionMs: number): number =>
  activeCueRange && !activeCueRange.directRelative
    ? activeCueRange.startMs + positionMs
    : positionMs;

export const isActiveDirectCueSegment = (): boolean => activeCueRange?.directRelative === true;
