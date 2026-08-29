import { insertPlayEvent } from "@main/database/playStats";
import type { PlayerState, Track } from "@shared/types/player";

/** Core 统一播放统计阈值：过短试听不落库。 */
const MIN_RECORD_MS = 5000;

interface CoreStatsSession {
  track: Track;
  startedAt: number;
  listenedMs: number;
  playingSince: number | null;
}

let session: CoreStatsSession | null = null;

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
 * Core 成功加载一首新曲后开始唯一的播放统计会话。
 * Desktop/Web Control 数量不会影响统计次数。
 */
export const beginCorePlayStats = (track: Track, autoPlay: boolean): void => {
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

/** Native 播放态变化只更新当前 Core 统计会话的墙钟累计。 */
export const onCorePlayerState = (state: PlayerState): void => {
  if (!session) return;
  if (state === "playing") {
    if (session.playingSince === null) session.playingSince = Date.now();
  } else {
    settle();
  }
};

/** 自然播放结束时立即结算，随后下一首会开启新的 Core 会话。 */
export const onCorePlayerEnded = (): void => {
  finalize();
};

/** Core 停止前刷出最后一段有效播放统计。 */
export const shutdownCorePlayStats = (): void => {
  finalize();
};
