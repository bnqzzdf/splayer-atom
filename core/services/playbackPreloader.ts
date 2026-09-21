import type { DirectStageResult, PlaybackQueueItem, TrackDetail } from "@shared/types/player";
import { discardDirectInput, materializeDirectInput } from "@main/atom/directInput";
import { toNativeSacdPlaybackSource } from "@main/atom/sacdInput";
import { cancelDirectPlaybackNext, stageDirectPlaybackNext } from "@main/services/directGapless";
import {
  cancelProcessedPlaybackNext,
  stageProcessedPlaybackNext,
} from "@main/services/processedGapless";
import { store } from "@main/store";
import { playerLog } from "@main/utils/logger";
import { directCueSegmentFromTrack } from "@main/services/playerTimeline";
import {
  discardPreparedUpnpMedia,
  prepareUpnpPlaybackMedia,
  type PreparedUpnpMedia,
} from "@main/atom/upnp/media";
import {
  resolvePlaybackSource,
  type ResolvedPlaybackSource,
} from "@main/services/playbackSourceResolver";
import { isAlsaProcessedOutput, isLocalDirectOutput } from "@main/services/alsaPlaybackMode";

interface PreparedPlaybackSource {
  key: string;
  queueIndex: number;
  item: PlaybackQueueItem;
  source: ResolvedPlaybackSource;
  directGeneration: number | null;
  directSource: string | null;
  directDetail?: DirectStageResult["detail"];
  processedGeneration: number | null;
  processedSource: string | null;
  processedDetail?: TrackDetail;
  upnpMedia?: PreparedUpnpMedia;
}

export interface ConsumedPlaybackPreload {
  source: ResolvedPlaybackSource;
  upnpMedia?: PreparedUpnpMedia;
}

export interface PreparedDirectPlaybackBoundary {
  queueIndex: number;
  item: PlaybackQueueItem;
  source: ResolvedPlaybackSource;
  directSource: string;
  directDetail?: DirectStageResult["detail"];
}

export interface PreparedProcessedPlaybackBoundary {
  queueIndex: number;
  item: PlaybackQueueItem;
  source: ResolvedPlaybackSource;
  processedSource: string;
  processedDetail?: TrackDetail;
}

let preloadToken = 0;
let pendingKey: string | null = null;
let prepared: PreparedPlaybackSource | null = null;
let nextDirectGeneration = 0;
let nextProcessedGeneration = 0;
let directStageChain: Promise<void> = Promise.resolve();

/** Direct 连续播放必须准备下一输入；普通输出仍尊重用户预载设置。 */
const shouldPrepareNextInput = (): boolean =>
  store.get("player.preloadNextTrack") === true ||
  isLocalDirectOutput(store.get("player.outputDevice"));

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
    item.track.cueStartFrame75 ?? "",
    item.track.cueEndFrame75 ?? "",
    item.track.cueStartMs ?? "",
    item.track.cueEndMs ?? "",
    store.get("player.songLevel"),
    store.get("player.allowTrialPlay"),
    store.get("player.outputDevice") ?? "",
    store.get("player.alsaPlaybackMode"),
  ].join("::");

/** 立即作废 native staged generation；新实现只改后台 staging slot，不触碰当前 producer/ring。 */
const cancelDirectStageNow = (): void => {
  try {
    cancelDirectPlaybackNext();
  } catch (error) {
    playerLog.debug(`[session] Direct preload cancel skipped: ${String(error)}`);
  }
};

const cancelProcessedStageNow = (): void => {
  try {
    cancelProcessedPlaybackNext();
  } catch (error) {
    playerLog.debug(`[session] processed preload cancel skipped: ${String(error)}`);
  }
};

const queueDirectCleanup = (source: string | null, discardSource = true): void => {
  if (!discardSource || !source) return;
  directStageChain = directStageChain
    .then(async () => {
      await discardDirectInput(source);
    })
    .catch((error) =>
      playerLog.debug(`[session] Direct preload cleanup skipped: ${String(error)}`),
    );
};

const queueUpnpCleanup = (media: PreparedUpnpMedia | undefined): void => {
  if (!media) return;
  void discardPreparedUpnpMedia(media).catch((error) =>
    playerLog.debug(`[session] UPnP preload cleanup skipped: ${String(error)}`),
  );
};

const clearPrepared = (cleanupOwned: boolean): void => {
  const directSource = prepared?.directSource ?? null;
  const processedSource = prepared?.processedSource ?? null;
  const upnpMedia = prepared?.upnpMedia;
  pendingKey = null;
  prepared = null;
  if (cleanupOwned) {
    cancelDirectStageNow();
    cancelProcessedStageNow();
    queueDirectCleanup(directSource);
    queueDirectCleanup(processedSource);
    queueUpnpCleanup(upnpMedia);
  }
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
  if (!isLocalDirectOutput(store.get("player.outputDevice"))) return null;

  let directSource =
    toNativeSacdPlaybackSource(resolved.source, track.track, track.duration) ?? resolved.source;
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
    cancelDirectStageNow();
    if (token !== preloadToken) return null;
    const segment = directCueSegmentFromTrack(track);
    if (track.cueStartMs != null && track.cueEndMs != null && !segment) {
      playerLog.warn(
        `[session] Direct CUE preload skipped: missing canonical 75fps boundary track=${track.id}`,
      );
      return null;
    }
    const result = await stageDirectPlaybackNext(
      directSource,
      track.duration ?? 0,
      generation,
      segment?.startFrame75,
      segment?.endFrame75,
    );
    if (token !== preloadToken && result.staged) {
      cancelDirectStageNow();
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

const canStageProcessed = (
  track: PlaybackQueueItem["track"],
  resolved: ResolvedPlaybackSource,
): boolean => {
  if (store.get("player.preloadNextTrack") !== true) return false;
  if (!isAlsaProcessedOutput(store.get("player.outputDevice"))) return false;
  if (
    track.cueStartFrame75 != null ||
    track.cueEndFrame75 != null ||
    track.cueStartMs != null ||
    track.cueEndMs != null ||
    track.cueAudioPath != null
  ) {
    return false;
  }
  // SACD/Native DSD 不进入 processed；保持正常 Ended -> load/reject 语义。
  if (toNativeSacdPlaybackSource(resolved.source, track.track, track.duration) != null) return false;
  return true;
};

const prepareProcessedSource = async (
  token: number,
  resolved: ResolvedPlaybackSource,
): Promise<{ source: ResolvedPlaybackSource; processedSource: string }> => {
  if (!/^https?:\/\//i.test(resolved.source)) {
    return { source: resolved, processedSource: resolved.source };
  }

  const cached = resolved.cacheAfterLoad ? await resolved.cacheAfterLoad() : null;
  if (token !== preloadToken) {
    return { source: resolved, processedSource: resolved.source };
  }
  const processedSource = cached ?? (await materializeDirectInput(resolved.source));
  if (token !== preloadToken) {
    if (!cached) await discardDirectInput(processedSource);
    return { source: resolved, processedSource: resolved.source };
  }
  return {
    source: {
      ...resolved,
      source: processedSource,
      provider: cached ? "cache" : resolved.provider,
      cacheAfterLoad: undefined,
    },
    processedSource,
  };
};

const stageProcessedSource = async (
  token: number,
  track: PlaybackQueueItem["track"],
  resolved: ResolvedPlaybackSource,
): Promise<{
  generation: number;
  source: ResolvedPlaybackSource;
  processedSource: string;
  detail?: TrackDetail;
} | null> => {
  if (!canStageProcessed(track, resolved)) return null;
  nextProcessedGeneration = (nextProcessedGeneration % 0xffff_ffff) + 1;
  const generation = nextProcessedGeneration;
  if (token !== preloadToken) return null;
  cancelProcessedStageNow();
  if (token !== preloadToken) return null;
  const prepared = await prepareProcessedSource(token, resolved);
  if (token !== preloadToken) return null;
  const result = await stageProcessedPlaybackNext(prepared.processedSource, generation);
  if (token !== preloadToken && result.staged) {
    cancelProcessedStageNow();
    queueDirectCleanup(prepared.processedSource);
    return null;
  }
  if (token !== preloadToken || !result?.staged) {
    queueDirectCleanup(prepared.processedSource);
    return null;
  }
  return {
    generation,
    source: prepared.source,
    processedSource: prepared.processedSource,
    detail: result.detail,
  };
};

/**
 * 后台解析下一首 canonical Track：Diretta 准备 Native staging，UPnP 准备最终本地媒体表示。
 * 失败只丢弃对应优化结果，真正切歌时仍会走正常 fresh resolve/load。
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
      let processedGeneration: number | null = null;
      let processedSource: string | null = null;
      let processedDetail: TrackDetail | undefined;
      let upnpMedia: PreparedUpnpMedia | undefined;
      const directPrepared = await prepareDirectSource(token, item.track, source);
      if (token !== preloadToken) {
        if (directPrepared?.directSource) queueDirectCleanup(directPrepared.directSource);
        return;
      }
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
      } else if (store.get("player.outputDevice")?.startsWith("upnp:") === true) {
        try {
          upnpMedia = await prepareUpnpPlaybackMedia(item, source);
        } catch (error) {
          if (token === preloadToken) {
            playerLog.debug(`[session] UPnP media preload skipped: ${String(error)}`);
          }
        }
        if (token !== preloadToken || buildPreloadKey(queueIndex, item) !== key) {
          await discardPreparedUpnpMedia(upnpMedia ?? null);
          return;
        }
      } else {
        try {
          const staged = await stageProcessedSource(token, item.track, source);
          if (staged) {
            processedGeneration = staged.generation;
            source = staged.source;
            processedSource = staged.processedSource;
            processedDetail = staged.detail;
          }
        } catch (error) {
          if (token === preloadToken) {
            playerLog.debug(`[session] processed gapless staging skipped: ${String(error)}`);
          }
        }
        if (token !== preloadToken || buildPreloadKey(queueIndex, item) !== key) {
          cancelProcessedStageNow();
          return;
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
        processedGeneration,
        processedSource,
        processedDetail,
        upnpMedia,
      };
      playerLog.debug(
        directGeneration !== null
          ? `[session] preloaded Direct next: ${item.track.title} generation=${directGeneration}`
          : processedGeneration !== null
            ? `[session] preloaded processed next: ${item.track.title} generation=${processedGeneration}`
          : upnpMedia
            ? `[session] preloaded UPnP media: ${item.track.title}`
            : `[session] preloaded source: ${item.track.title}`,
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
): ConsumedPlaybackPreload | null => {
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
  const result: ConsumedPlaybackPreload = {
    source: prepared.source,
    upnpMedia: prepared.upnpMedia,
  };
  preloadToken++;
  cancelDirectStageNow();
  cancelProcessedStageNow();
  clearPrepared(false);
  return result;
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

/** processed DAC-side boundary 只接受仍匹配当前 Core queue/policy 的 staged generation。 */
export const consumeProcessedPlaybackBoundary = (
  generation: number,
  queue: readonly PlaybackQueueItem[],
): PreparedProcessedPlaybackBoundary | null => {
  if (
    !prepared ||
    prepared.processedGeneration !== generation ||
    !prepared.processedSource
  ) {
    return null;
  }
  const current = queue[prepared.queueIndex];
  if (!current || buildPreloadKey(prepared.queueIndex, current) !== prepared.key) {
    invalidatePlaybackPreload();
    return null;
  }
  const result: PreparedProcessedPlaybackBoundary = {
    queueIndex: prepared.queueIndex,
    item: prepared.item,
    source: prepared.source,
    processedSource: prepared.processedSource,
    processedDetail: prepared.processedDetail,
  };
  preloadToken++;
  clearPrepared(false);
  return result;
};
