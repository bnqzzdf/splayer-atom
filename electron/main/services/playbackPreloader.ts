import type { PlaybackQueueItem } from "@shared/types/player";
import { isHeadlessMode } from "@main/runtime";
import { store } from "@main/store";
import { playerLog } from "@main/utils/logger";
import {
  resolvePlaybackSource,
  type ResolvedPlaybackSource,
} from "@main/services/playbackSourceResolver";

interface PreparedPlaybackSource {
  key: string;
  source: ResolvedPlaybackSource;
}

let preloadToken = 0;
let pendingKey: string | null = null;
let prepared: PreparedPlaybackSource | null = null;

/** 只包含会改变实际播放输入的 Core policy；Control 展示状态不参与。 */
const buildPreloadKey = (queueIndex: number, item: PlaybackQueueItem): string =>
  [
    queueIndex,
    item.track.id,
    item.track.source,
    item.track.serverId ?? "",
    item.track.originalId ?? "",
    item.track.path ?? "",
    item.track.cueAudioPath ?? "",
    store.get("player.songLevel"),
    store.get("player.allowTrialPlay"),
  ].join("::");

export const invalidatePlaybackPreload = (): void => {
  preloadToken++;
  pendingKey = null;
  prepared = null;
};

/**
 * 后台解析下一首 canonical Track；不触发播放，不拥有队列。
 * 解析失败只丢弃预载结果，真正切歌时仍会走正常 fresh resolve。
 */
export const schedulePlaybackPreload = (queueIndex: number, item: PlaybackQueueItem): void => {
  if (!isHeadlessMode() || store.get("player.preloadNextTrack") !== true) {
    invalidatePlaybackPreload();
    return;
  }

  const key = buildPreloadKey(queueIndex, item);
  if (prepared?.key === key || pendingKey === key) return;

  const token = ++preloadToken;
  pendingKey = key;
  prepared = null;

  void resolvePlaybackSource(item.track)
    .then((source) => {
      if (token !== preloadToken || buildPreloadKey(queueIndex, item) !== key) return;
      pendingKey = null;
      prepared = { key, source };
      playerLog.debug(`[session] preloaded source: ${item.track.title}`);
    })
    .catch((error) => {
      if (token !== preloadToken) return;
      pendingKey = null;
      prepared = null;
      playerLog.debug(`[session] source preload skipped: ${String(error)}`);
    });
};

/** 仅当队列位置、canonical Track 与 Core playback policy 全部一致时消费。 */
export const consumePlaybackPreload = (
  queueIndex: number,
  item: PlaybackQueueItem,
): ResolvedPlaybackSource | null => {
  if (!isHeadlessMode() || store.get("player.preloadNextTrack") !== true) {
    invalidatePlaybackPreload();
    return null;
  }
  if (!prepared) return null;
  const key = buildPreloadKey(queueIndex, item);
  if (prepared.key !== key) {
    invalidatePlaybackPreload();
    return null;
  }
  const source = prepared.source;
  invalidatePlaybackPreload();
  return source;
};
