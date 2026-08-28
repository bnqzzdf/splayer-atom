import { insertPlayEvent } from "@main/database/playStats";
import { isHeadlessMode } from "@main/runtime";
import type { PlayerState, Track } from "@shared/types/player";

/** 与 renderer 播放统计保持一致：过短试听不落库。 */
const MIN_RECORD_MS = 5000;

interface HeadlessStatsSession {
  track: Track;
  startedAt: number;
  listenedMs: number;
  playingSince: number | null;
}

let session: HeadlessStatsSession | null = null;

const settle = (): void => {
  if (!session || session.playingSince === null) return;
  session.listenedMs += Date.now() - session.playingSince;
  session.playingSince = null;
};

const finalize = (): void => {
  if (!session) return;
  settle();
  const { track, startedAt, listenedMs } = session;
  session = null;
  if (listenedMs < MIN_RECORD_MS) return;
  insertPlayEvent({ track, startedAt, listenedMs });
};

/**
 * Headless 主进程成功加载一首新曲后开始唯一的播放统计会话。
 * Web 客户端数量不会影响统计次数。
 */
export const beginHeadlessPlayStats = (track: Track, autoPlay: boolean): void => {
  if (!isHeadlessMode()) return;
  const now = Date.now();
  if (session && session.track.source === track.source && session.track.id === track.id) {
    // 同一首的重载（例如音源恢复）延续原统计会话，不重复计数。
    settle();
    session.track = track;
    session.playingSince = autoPlay ? now : null;
    return;
  }
  finalize();
  session = {
    track,
    startedAt: now,
    listenedMs: 0,
    playingSince: autoPlay ? now : null,
  };
};

/** Native 播放态变化只更新当前 Headless 统计会话的墙钟累计。 */
export const onHeadlessPlayerState = (state: PlayerState): void => {
  if (!isHeadlessMode() || !session) return;
  if (state === "playing") {
    if (session.playingSince === null) session.playingSince = Date.now();
  } else {
    settle();
  }
};

/** 自然播放结束时立即结算，随后下一首会开启新的主进程会话。 */
export const onHeadlessPlayerEnded = (): void => {
  if (!isHeadlessMode()) return;
  finalize();
};
