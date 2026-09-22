import type {
  PlaybackQueueItem,
  PlaybackSessionSnapshot,
  RepeatMode,
  ShuffleMode,
  Track,
} from "@shared/types/player";
import { getDb, isDbOpen } from "./index";
import { getTracksByIds } from "./queries";

interface PlaybackSessionRow {
  queue_json: string;
  original_queue_json: string | null;
  current_index: number;
  repeat_mode: string;
  shuffle_mode: string;
}

const parseQueue = (value: string | null): PlaybackQueueItem[] | null => {
  if (value == null) return null;
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error("playback session queue is not an array");
  return parsed as PlaybackQueueItem[];
};

const parseRepeat = (value: string): RepeatMode => {
  if (value === "one") return "one";
  if (value === "list") return "list";
  return "off";
};
const parseShuffle = (value: string): ShuffleMode => (value === "on" ? "on" : "off");

const isLocalCueTrack = (track: Track): boolean =>
  track.source === "local" && track.cuePath != null && track.cueAudioPath != null;

/**
 * 旧 playback_session JSON 可能只有 cueStartMs/cueEndMs。Direct 精确边界不能从毫秒
 * 猜测，因此恢复时只从当前 library canonical Track 补齐原始 75fps INDEX 坐标。
 * 找不到 canonical Track 时保持旧数据原样，让 Direct 路径安全退回非 segment 行为。
 */
export const refreshPersistedCueCoordinates = (items: PlaybackQueueItem[]): PlaybackQueueItem[] => {
  const cueIds = [
    ...new Set(items.filter((item) => isLocalCueTrack(item.track)).map((item) => item.track.id)),
  ];
  if (cueIds.length === 0) return items.map((item) => ({ ...item, track: { ...item.track } }));

  const canonicalById = new Map(
    getTracksByIds(cueIds)
      .filter(isLocalCueTrack)
      .map((track) => [track.id, track] as const),
  );

  return items.map((item) => {
    const track = item.track;
    if (!isLocalCueTrack(track)) return { ...item, track: { ...track } };
    const canonical = canonicalById.get(track.id);
    if (
      !canonical ||
      canonical.cuePath !== track.cuePath ||
      canonical.cueAudioPath !== track.cueAudioPath ||
      canonical.cueStartFrame75 == null
    ) {
      return { ...item, track: { ...track } };
    }
    return {
      ...item,
      track: {
        ...track,
        cueStartFrame75: canonical.cueStartFrame75,
        cueEndFrame75: canonical.cueEndFrame75,
      },
    };
  });
};

/** playback session schema 属于 Atom delta，由本模块按需确保，不侵入 upstream library schema。 */
const ensurePlaybackSessionTable = (): void => {
  if (!isDbOpen()) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS playback_session (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      queue_json TEXT NOT NULL,
      original_queue_json TEXT,
      current_index INTEGER NOT NULL,
      repeat_mode TEXT NOT NULL,
      shuffle_mode TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
};

/** 读取主进程唯一播放会话的持久化快照。 */
export const loadPlaybackSession = (): PlaybackSessionSnapshot | null => {
  if (!isDbOpen()) return null;
  ensurePlaybackSessionTable();
  const row = getDb()
    .prepare(
      `SELECT queue_json, original_queue_json, current_index, repeat_mode, shuffle_mode
       FROM playback_session WHERE id = 1`,
    )
    .get() as PlaybackSessionRow | undefined;
  if (!row) return null;
  const queue = refreshPersistedCueCoordinates(parseQueue(row.queue_json) ?? []);
  const parsedOriginalQueue = parseQueue(row.original_queue_json);
  const originalQueue = parsedOriginalQueue
    ? refreshPersistedCueCoordinates(parsedOriginalQueue)
    : null;
  const index =
    queue.length === 0 ? -1 : Math.max(0, Math.min(row.current_index, queue.length - 1));
  return {
    active: queue.length > 0,
    mode: "queue",
    queue,
    originalQueue,
    index,
    current: index >= 0 ? (queue[index]?.track ?? null) : null,
    repeat: parseRepeat(row.repeat_mode),
    shuffle: parseShuffle(row.shuffle_mode),
  };
};

/** 原子保存主进程唯一播放会话；整队列 JSON 与旧 renderer localforage 的写入粒度一致。 */
export const savePlaybackSession = (session: PlaybackSessionSnapshot): void => {
  if (!isDbOpen()) return;
  ensurePlaybackSessionTable();
  getDb()
    .prepare(
      `INSERT INTO playback_session
         (id, queue_json, original_queue_json, current_index, repeat_mode, shuffle_mode, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         queue_json = excluded.queue_json,
         original_queue_json = excluded.original_queue_json,
         current_index = excluded.current_index,
         repeat_mode = excluded.repeat_mode,
         shuffle_mode = excluded.shuffle_mode,
         updated_at = excluded.updated_at`,
    )
    .run(
      JSON.stringify(session.queue),
      session.originalQueue ? JSON.stringify(session.originalQueue) : null,
      session.index,
      session.repeat,
      session.shuffle,
      Date.now(),
    );
};
