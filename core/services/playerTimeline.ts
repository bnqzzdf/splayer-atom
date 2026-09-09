import type { Track } from "@shared/types/player";

export interface CueRange {
  startMs: number;
  durationMs: number;
}

let activeCueRange: CueRange | null = null;

export const cueRangeFromTrack = (track: Track | null | undefined): CueRange | null => {
  const start = track?.cueStartMs;
  const end = track?.cueEndMs;
  if (start == null || end == null || end <= start) return null;
  return { startMs: start, durationMs: end - start };
};

export const setActiveCueTrack = (track: Track | null | undefined): CueRange | null => {
  activeCueRange = cueRangeFromTrack(track);
  return activeCueRange;
};

export const clearActiveCueRange = (): void => {
  activeCueRange = null;
};

export const toDisplayPositionMs = (positionMs: number): number => {
  if (!activeCueRange) return positionMs;
  return Math.max(0, Math.min(activeCueRange.durationMs, positionMs - activeCueRange.startMs));
};

export const toDisplayDurationMs = (durationMs: number): number =>
  activeCueRange?.durationMs ?? durationMs;

export const toEnginePositionMs = (positionMs: number): number =>
  activeCueRange ? activeCueRange.startMs + positionMs : positionMs;
