import { sessionClient } from "@/core/sessionClient";
import type { PlaybackQueueItem, PlaybackSessionSnapshot, Track } from "@shared/types/player";

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

/**
 * 读取 Core 权威播放会话。
 * Web Control 不持久化或迁移第二份 renderer 队列。
 * @returns 当前 Core 权威会话
 */
export const restoreQueue = async (): Promise<PlaybackSessionSnapshot | null> => {
  try {
    const current = await sessionClient.getSession();
    if (!current.success || !current.data) return null;
    applySession(current.data);
    return current.data;
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
