import type {
  PlaybackQueueItem,
  PlaybackSessionSnapshot,
  RepeatMode,
  ShuffleMode,
} from "@shared/types/player";
import { getDb, isDbOpen } from "./index";

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

const parseRepeat = (value: string): RepeatMode => (value === "one" ? "one" : "list");
const parseShuffle = (value: string): ShuffleMode => (value === "on" ? "on" : "off");

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
  const queue = parseQueue(row.queue_json) ?? [];
  const originalQueue = parseQueue(row.original_queue_json);
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
