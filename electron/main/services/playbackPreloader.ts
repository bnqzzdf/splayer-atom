import type { DirectStageResult, PlaybackQueueItem } from "@shared/types/player";
import { discardDirectInput, materializeDirectInput } from "@main/atom/directInput";
import { cancelDirectPlaybackNext, stageDirectPlaybackNext } from "@main/services/directGapless";
import { getPlayer } from "@main/services/engine";
import { store } from "@main/store";
import { playerLog } from "@main/utils/logger";
import {
  resolvePlaybackSource,
  type ResolvedPlaybackSource,
} from "@main/services/playbackSourceResolver";

interface PreparedPlaybackSource {
  key: string;
  queueIndex: number;
  item: PlaybackQueueItem;
  source: ResolvedPlaybackSource;
  directGeneration: number | null;
  directSource: string | null;
  directDetail?: DirectStageResult["detail"];
}

export interface PreparedDirectPlaybackBoundary {
  queueIndex: number;
  item: PlaybackQueueItem;
  source: ResolvedPlaybackSource;
  directSource: string;
  directDetail?: DirectStageResult["detail"];
}

let preloadToken = 0;
let pendingKey: string | null = null;
let prepared: PreparedPlaybackSource | null = null;
let nextDirectGeneration = 0;
let directStageChain: Promise<void> = Promise.resolve();

/** Diretta 连续播放必须准备下一输入；普通输出仍尊重用户预载设置。 */
const shouldPrepareNextInput = (): boolean =>
  store.get("player.preloadNextTrack") === true ||
  getPlayer().getSelectedDeviceName()?.startsWith("diretta:") === true;

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
    store.get("player.outputDevice") ?? "",
  ].join("::");

const queueDirectCleanup = (
  source: string | null,
  discardSource = true,
  cancelStaged = true,
): void => {
  directStageChain = directStageChain
    .then(async () => {
      if (cancelStaged) {
        try {
          cancelDirectPlaybackNext();
        } catch (error) {
          playerLog.debug(`[session] Direct preload cancel skipped: ${String(error)}`);
        }
      }
      if (discardSource && source) await discardDirectInput(source);
    })
    .catch((error) =>
      playerLog.debug(`[session] Direct preload cleanup skipped: ${String(error)}`),
    );
};

const clearPrepared = (cleanupDirect: boolean): void => {
  const directSource = prepared?.directSource ?? null;
  const hasStagedDirectNext = prepared?.directGeneration != null;
  pendingKey = null;
  prepared = null;
  if (cleanupDirect) queueDirectCleanup(directSource, true, hasStagedDirectNext);
};

export const invalidatePlaybackPreload = (): void => {
  preloadToken++;
  clearPrepared(true);
};

/** normal/full load 开始前必须等待旧 Direct staging/control 命令完全静止。 */
export const waitForPlaybackPreloadIdle = (): Promise<void> => directStageChain;

const prepareDirectSource = async (
  token: number,
  track: PlaybackQueueItem["track"],
  resolved: ResolvedPlaybackSource,
): Promise<{ source: ResolvedPlaybackSource; directSource: string } | null> => {
  if (getPlayer().getSelectedDeviceName()?.startsWith("diretta:") !== true) return null;
  if (track.cueStartMs != null || track.cueEndMs != null) return null;

  let directSource = resolved.source;
  let preparedSource = resolved;
  if (/^https?:\/\//i.test(directSource)) {
    const cached = resolved.cacheAfterLoad ? await resolved.cacheAfterLoad() : null;
    if (token !== preloadToken) return null;
    directSource = cached ?? (await materializeDirectInput(directSource));
    if (token !== preloadToken) {
      await discardDirectInput(directSource);
      return null;
    }
    preparedSource = {
      ...resolved,
      source: directSource,
      provider: cached ? "cache" : resolved.provider,
      cacheAfterLoad: undefined,
    };
  }

  return { source: preparedSource, directSource };
};

const stageDirectSource = async (
  token: number,
  track: PlaybackQueueItem["track"],
  directSource: string,
): Promise<{ generation: number; detail?: DirectStageResult["detail"] } | null> => {
  nextDirectGeneration = (nextDirectGeneration % 0xffff_ffff) + 1;
  const generation = nextDirectGeneration;
  const operation = directStageChain.then(async (): Promise<DirectStageResult | null> => {
    if (token !== preloadToken) return null;
    try {
      cancelDirectPlaybackNext();
    } catch {}
    if (token !== preloadToken) return null;
    const result = await stageDirectPlaybackNext(directSource, track.duration ?? 0, generation);
    if (token !== preloadToken && result.staged) {
      try {
        cancelDirectPlaybackNext();
      } catch {}
      return null;
    }
    return result;
  });
  directStageChain = operation.then(
    () => undefined,
    () => undefined,
  );
  const result = await operation;

  if (token !== preloadToken || !result?.staged) return null;
  return { generation, detail: result.detail };
};

/**
 * 后台解析下一首 canonical Track，并在 Core Local Output 为 Diretta 时准备同 connection staging。
 * 失败只丢弃预载结果，真正切歌时仍会走正常 fresh resolve/load。
 */
export const schedulePlaybackPreload = (queueIndex: number, item: PlaybackQueueItem): void => {
  if (!shouldPrepareNextInput()) {
    invalidatePlaybackPreload();
    return;
  }

  const key = buildPreloadKey(queueIndex, item);
  if (prepared?.key === key || pendingKey === key) return;

  invalidatePlaybackPreload();
  const token = ++preloadToken;
  pendingKey = key;

  void (async () => {
    try {
      let source = await resolvePlaybackSource(item.track);
      if (token !== preloadToken || buildPreloadKey(queueIndex, item) !== key) return;

      let directGeneration: number | null = null;
      let directSource: string | null = null;
      let directDetail: DirectStageResult["detail"] | undefined;
      const directPrepared = await prepareDirectSource(token, item.track, source);
      if (token !== preloadToken) return;
      if (directPrepared) {
        source = directPrepared.source;
        directSource = directPrepared.directSource;
        const staged = await stageDirectSource(token, item.track, directSource);
        if (token !== preloadToken) {
          await discardDirectInput(directSource);
          return;
        }
        if (staged) {
          directGeneration = staged.generation;
          directDetail = staged.detail;
        }
      }

      pendingKey = null;
      prepared = {
        key,
        queueIndex,
        item: { ...item, track: { ...item.track } },
        source,
        directGeneration,
        directSource,
        directDetail,
      };
      playerLog.debug(
        directGeneration === null
          ? `[session] preloaded source: ${item.track.title}`
          : `[session] preloaded Direct next: ${item.track.title} generation=${directGeneration}`,
      );
    } catch (error) {
      if (token !== preloadToken) return;
      clearPrepared(true);
      playerLog.debug(`[session] source preload skipped: ${String(error)}`);
    }
  })();
};

/** 仅当队列位置、canonical Track 与 Core playback policy 全部一致时消费普通预载。 */
export const consumePlaybackPreload = (
  queueIndex: number,
  item: PlaybackQueueItem,
): ResolvedPlaybackSource | null => {
  if (!shouldPrepareNextInput()) {
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
  const hasStagedDirectNext = prepared.directGeneration !== null;
  preloadToken++;
  queueDirectCleanup(prepared.directSource, false, hasStagedDirectNext);
  clearPrepared(false);
  return source;
};

/** native 已跨过 Direct boundary 时，只接受仍匹配当前 Core queue/policy 的 staged generation。 */
export const consumeDirectPlaybackBoundary = (
  generation: number,
  queue: readonly PlaybackQueueItem[],
): PreparedDirectPlaybackBoundary | null => {
  if (!prepared || prepared.directGeneration !== generation || !prepared.directSource) return null;
  const current = queue[prepared.queueIndex];
  if (!current || buildPreloadKey(prepared.queueIndex, current) !== prepared.key) {
    invalidatePlaybackPreload();
    return null;
  }

  const result: PreparedDirectPlaybackBoundary = {
    queueIndex: prepared.queueIndex,
    item: prepared.item,
    source: prepared.source,
    directSource: prepared.directSource,
    directDetail: prepared.directDetail,
  };
  preloadToken++;
  clearPrepared(false);
  return result;
};
