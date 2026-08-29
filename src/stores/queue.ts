import localforage from "localforage";
import { isWebRemote } from "@/runtime";
import { sessionClient } from "@/core/sessionClient";
import type {
  PlaybackQueueItem,
  PlaybackSessionSnapshot,
  RepeatMode,
  ShuffleMode,
  Track,
} from "@shared/types/player";

const db = localforage.createInstance({ name: "splayer", storeName: "queue" });

type PersistedQueueItem = Track | PlaybackQueueItem;

export interface LegacyQueueState {
  index: number;
  repeat: RepeatMode;
  shuffle: ShuffleMode;
}

/** 兼容旧版本直接持久化的 Track 队列。 */
const restoreQueueItem = (value: PersistedQueueItem): PlaybackQueueItem => {
  if (typeof value.track === "object" && value.track !== null) return value as PlaybackQueueItem;
  return { track: value as Track };
};

/** 当前播放队列项；仅是 main session 的 renderer 响应式投影。 */
export const queueEntries = shallowRef<PlaybackQueueItem[]>([]);

/** 供界面和音源预载消费的纯曲目列表。 */
export const queue = computed<Track[]>(() => queueEntries.value.map((item) => item.track));

/** 随机播放前的原顺序投影；唯一权威仍在 main session。 */
export const originalQueue = shallowRef<PlaybackQueueItem[] | null>(null);

/** 队列中的歌曲总数。 */
export const queueLength = computed(() => queue.value.length);

/** 应用主进程权威播放会话快照。 */
export const applySession = (session: PlaybackSessionSnapshot): void => {
  queueEntries.value = session.queue.map((item) => ({ ...item, track: { ...item.track } }));
  originalQueue.value = session.originalQueue
    ? session.originalQueue.map((item) => ({ ...item, track: { ...item.track } }))
    : null;
};

const clearLegacyQueue = (): Promise<unknown[]> =>
  Promise.all([db.removeItem("playList"), db.removeItem("originalPlayList")]);

/**
 * 恢复 main session；若 main 尚无队列，则一次性迁移旧 renderer IndexedDB。
 * @param legacyState - 升级前由 Pinia 持久化的索引和播放模式
 * @returns 当前主进程权威会话
 */
export const restoreQueue = async (
  legacyState: LegacyQueueState,
): Promise<PlaybackSessionSnapshot | null> => {
  try {
    const current = await sessionClient.getSession();
    if (!current.success || !current.data) return null;
    if (current.data.queue.length > 0 || isWebRemote()) {
      applySession(current.data);
      if (!isWebRemote()) await clearLegacyQueue();
      return current.data;
    }

    const [list, original] = await Promise.all([
      db.getItem<PersistedQueueItem[]>("playList"),
      db.getItem<PersistedQueueItem[] | null>("originalPlayList"),
    ]);
    if (!list?.length) {
      applySession(current.data);
      return current.data;
    }

    const result = await sessionClient.migrateLegacySessionQueue(
      list.map(restoreQueueItem),
      original?.map(restoreQueueItem) ?? null,
      legacyState.index,
      legacyState.repeat,
      legacyState.shuffle,
    );
    if (!result.success || !result.data) return null;
    applySession(result.data);
    await clearLegacyQueue();
    return result.data;
  } catch (error) {
    console.error("[queue] 恢复权威队列失败:", error);
    return null;
  }
};

/** 根据索引获取 Track，越界时返回 null。 */
export const getTrack = (index: number): Track | null => getQueueItem(index)?.track ?? null;

/** 根据索引获取队列项，越界时返回 null。 */
export const getQueueItem = (index: number): PlaybackQueueItem | null =>
  index >= 0 && index < queueEntries.value.length ? queueEntries.value[index] : null;

/** 根据 ID 查找 Track 在队列中的索引，未找到返回 -1。 */
export const findTrackIndex = (trackId: string): number =>
  queueEntries.value.findIndex((item) => item.track.id === trackId);

/** 清空主进程权威队列；renderer 只在响应后应用快照。 */
export const clearQueue = (): void => {
  void sessionClient
    .clearSessionQueue(true)
    .then((result) => {
      if (!result.success) console.error("[queue] 清空权威队列失败:", result.error);
      else if (result.data) applySession(result.data);
      else console.error("[queue] 清空权威队列失败: 缺少会话快照");
    })
    .catch((error) => console.error("[queue] 清空权威队列失败:", error));
};

/**
 * 移除指定流媒体服务器的主进程权威队列项。
 * @param serverId - 流媒体服务器 ID
 */
export const removeServerTracks = (serverId: string): void => {
  void sessionClient
    .removeSessionServerTracks(serverId)
    .then((result) => {
      if (!result.success) console.error("[queue] 移除流媒体服务器队列失败:", result.error);
      else if (result.data) applySession(result.data);
      else console.error("[queue] 移除流媒体服务器队列失败: 缺少会话快照");
    })
    .catch((error) => console.error("[queue] 移除流媒体服务器队列失败:", error));
};
