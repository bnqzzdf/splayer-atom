/**
 * 下一首歌曲预载服务
 */

import type { PlaybackContext, Track, TrackDetail } from "@shared/types/player";
import type { ResolvedTrackSource } from "@/services/audioSource";
import { getNextTrackCandidate } from "@/core/player/candidate";
import { invalidatePreloadedLyric, preloadLyricForTrack } from "@/services/lyric/preload";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { useStreamingStore } from "@/stores/streaming";
import { usePluginsStore } from "@/stores/plugins";
import { useMediaStore } from "@/stores/media";
import * as queue from "@/stores/queue";

/** 预载结果 */
export interface NextTrackPreloadResult {
  trackId: string;
  track: Track;
  queueIndex: number;
  context?: PlaybackContext;
  source: ResolvedTrackSource | null;
  contextKey: string;
  directGeneration: number | null;
  directDetail?: TrackDetail;
}

let cachedResult: NextTrackPreloadResult | null = null;
let currentContextKey: string | null = null;
let pendingCover: HTMLImageElement | null = null;
let stopContextWatch: (() => void) | null = null;
let activeDirectGeneration: number | null = null;

/**
 * 拼装上下文指纹，用于去重与作废
 */
const buildContextKey = (track: Track): string => {
  const settings = useSettingsStore();
  const status = useStatusStore();
  const streaming = useStreamingStore();
  const plugins = usePluginsStore();

  const parts = [
    track.id,
    track.source,
    track.serverId ?? "",
    track.originalId ?? "",
    track.path ?? "",
    track.cueAudioPath ?? "",
    settings.system.player.songLevel,
    settings.system.player.allowTrialPlay,
    settings.system.player.fuckDjMode,
    settings.player.outputDevice ?? "",
    status.repeatMode,
    status.autoClose.enable,
    status.autoClose.waitSongEnd,
    streaming.activeServerId ?? "",
    plugins.list
      .map((plugin) =>
        JSON.stringify([
          plugin.manifest.id,
          plugin.enabled,
          plugin.status.state,
          plugin.status.state === "ready" ? plugin.status.sources : null,
        ]),
      )
      .join(";"),
  ];

  return parts.join("::");
};

/**
 * 提前解码封面图片，仅利用 Chromium 渲染引擎缓存
 */
const preloadCover = async (url: string): Promise<void> => {
  if (!url) return;
  if (pendingCover) pendingCover.src = "";
  const image = new Image();
  pendingCover = image;
  try {
    image.decoding = "async";
    image.src = url;
    await image.decode();
  } catch {
    // ignore
  } finally {
    if (pendingCover === image) pendingCover = null;
  }
};

/**
 * 作废当前的预载缓存
 */
export const invalidateNextTrackPreload = (): void => {
  cachedResult = null;
  currentContextKey = null;
  if (activeDirectGeneration !== null) {
    activeDirectGeneration = null;
    void window.api.player.cancelDirectNext();
  }
  if (pendingCover) {
    pendingCover.src = "";
    pendingCover = null;
  }
  invalidatePreloadedLyric();
};

/**
 * 消费预载结果
 * @param track - 正在切入播放的目标歌曲
 * @returns 匹配的预载结果，未命中或已作废则返回 null
 */
export const consumePreloadedTrack = (track: Track): NextTrackPreloadResult | null => {
  const currentKey = buildContextKey(track);
  if (!cachedResult) {
    if (currentContextKey === currentKey) {
      // renderer 已不再解析播放输入；仅清理旧迁移期上下文。
      currentContextKey = null;
    } else if (currentContextKey) {
      invalidateNextTrackPreload();
    }
    return null;
  }
  if (cachedResult.trackId !== track.id) {
    invalidateNextTrackPreload();
    return null;
  }
  if (cachedResult.contextKey !== currentKey) {
    // 上下文已改变（如切换了音质），当前缓存作废
    invalidateNextTrackPreload();
    return null;
  }
  const result = cachedResult;
  cachedResult = null;
  currentContextKey = null;
  if (result.directGeneration !== null) {
    activeDirectGeneration = null;
    void window.api.player.cancelDirectNext();
  }
  return result;
};

/**
 * 消费已经由 native 在同一 Diretta connection 上切入的 staged 下一首。
 * generation 由 renderer 在 staging 前生成，避免边界事件与 IPC Promise 返回次序产生竞态。
 */
export const consumeDirectGaplessBoundary = (generation: number): NextTrackPreloadResult | null => {
  const result = cachedResult;
  if (!result || result.directGeneration !== generation) {
    invalidateNextTrackPreload();
    return null;
  }
  const settings = useSettingsStore();
  const status = useStatusStore();
  const candidate = getNextTrackCandidate({
    playIndex: status.playIndex,
    queue: queue.queue.value,
    fmMode: status.fmMode,
    fuckDjMode: settings.system.player.fuckDjMode,
    shuffleMode: status.shuffleMode,
  });
  if (
    !candidate ||
    candidate.index !== result.queueIndex ||
    candidate.track.id !== result.trackId ||
    buildContextKey(candidate.track) !== result.contextKey
  ) {
    invalidateNextTrackPreload();
    return null;
  }
  cachedResult = null;
  currentContextKey = null;
  activeDirectGeneration = null;
  return result;
};

/**
 * 调度下一首预载任务
 */
export const scheduleNextTrackPreload = (): void => {
  const settings = useSettingsStore();
  if (!settings.system.player.preloadNextTrack) {
    invalidateNextTrackPreload();
    return;
  }

  const status = useStatusStore();
  const currentTrack = status.currentTrack;
  if (!currentTrack || useMediaStore().track?.id !== currentTrack.id) {
    invalidateNextTrackPreload();
    return;
  }
  const candidateResult = getNextTrackCandidate({
    playIndex: status.playIndex,
    queue: queue.queue.value,
    fmMode: status.fmMode,
    fuckDjMode: settings.system.player.fuckDjMode,
    shuffleMode: status.shuffleMode,
  });

  if (!candidateResult) {
    invalidateNextTrackPreload();
    return;
  }

  const candidateTrack = candidateResult.track;
  // Control 只预热展示资源；播放输入解析、缓存与 Direct staging 由 Core 唯一持有。
  cachedResult = null;
  currentContextKey = null;
  if (activeDirectGeneration !== null) {
    activeDirectGeneration = null;
    void window.api.player.cancelDirectNext();
  }
  preloadLyricForTrack(candidateTrack);
  if (candidateTrack.cover) void preloadCover(candidateTrack.cover);
};

/** 安装预载上下文监听 */
export const installNextTrackPreloadWatchers = (): void => {
  if (stopContextWatch) return;
  const settings = useSettingsStore();
  const status = useStatusStore();
  const streaming = useStreamingStore();
  const plugins = usePluginsStore();
  stopContextWatch = watch(
    () => [
      settings.system.player.preloadNextTrack,
      settings.system.player.songLevel,
      settings.system.player.allowTrialPlay,
      settings.system.player.fuckDjMode,
      status.playIndex,
      status.fmMode,
      status.shuffleMode,
      status.repeatMode,
      status.autoClose.enable,
      status.autoClose.waitSongEnd,
      queue.queue.value,
      streaming.activeServerId,
      settings.lyric.lyricSourcePreference,
      settings.lyric.lyricSourceOrder.join(","),
      settings.lyric.lyricFormatOrder.join(","),
      settings.lyric.smartPreferOnline,
      settings.lyric.preferPluginLyric,
      settings.system.lyric.enableOnlineTTMLLyric,
      settings.system.localLyric.enableLocalTTMLOverride,
      settings.system.localLyric.repoDir,
      plugins.list
        .map((plugin) =>
          JSON.stringify([
            plugin.manifest.id,
            plugin.enabled,
            plugin.status.state,
            plugin.status.state === "ready" ? plugin.status.sources : null,
          ]),
        )
        .join(";"),
    ],
    scheduleNextTrackPreload,
    { flush: "post" },
  );
};

/** 清理预载上下文监听 */
export const disposeNextTrackPreload = (): void => {
  stopContextWatch?.();
  stopContextWatch = null;
  invalidateNextTrackPreload();
};
