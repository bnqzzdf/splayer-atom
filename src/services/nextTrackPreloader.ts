/**
 * 下一首歌曲预载服务
 */

import type { PlaybackContext, Track, TrackDetail } from "@shared/types/player";
import type { ResolvedTrackSource } from "@/services/audioSource";
import { prepareDirectTrackSource, resolveTrackSource } from "@/services/audioSource";
import { getNextTrackCandidate } from "@/core/player/candidate";
import { invalidatePreloadedLyric, preloadLyricForTrack } from "@/services/lyric/preload";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { useStreamingStore } from "@/stores/streaming";
import { usePluginsStore } from "@/stores/plugins";
import { useMediaStore } from "@/stores/media";
import * as queue from "@/stores/queue";
import { isWebRemote } from "@/runtime";

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

let currentToken = 0;
let cachedResult: NextTrackPreloadResult | null = null;
let currentContextKey: string | null = null;
let pendingCover: HTMLImageElement | null = null;
let stopContextWatch: (() => void) | null = null;
let nextDirectGeneration = 0;
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
  currentToken++;
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
      // 音源尚未解析完成，阻止迟到结果写回；同曲歌词和封面仍可继续使用
      currentToken++;
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
  currentToken++;
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
  currentToken++;
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
  const contextKey = buildContextKey(candidateTrack);
  // 歌词使用独立上下文去重，歌词偏好变化不需要重新解析音源
  preloadLyricForTrack(candidateTrack);
  if (isWebRemote()) {
    // 远程 Web 只做 UI 预热；播放输入与 Direct staging 由 Core 唯一持有。
    currentToken++;
    cachedResult = null;
    currentContextKey = null;
    if (candidateTrack.cover) void preloadCover(candidateTrack.cover);
    return;
  }

  // 上下文指纹一致且已有缓存，避免重复触发
  if (cachedResult && cachedResult.contextKey === contextKey) {
    return;
  }

  // 避免在异步生成过程中重复调度同一 contextKey
  if (currentContextKey === contextKey && !cachedResult) {
    return;
  }

  if (activeDirectGeneration !== null) {
    activeDirectGeneration = null;
    void window.api.player.cancelDirectNext();
  }

  const token = ++currentToken;
  currentContextKey = contextKey;
  cachedResult = null;

  void (async () => {
    try {
      if (candidateTrack.cover) {
        void preloadCover(candidateTrack.cover);
      }
      // 音源预拉取
      let source = await resolveTrackSource(candidateTrack, {
        silent: true,
        streamingPlaySessionId: crypto.randomUUID(),
      });
      if (token !== currentToken) return;

      const directOutput = settings.player.outputDevice?.startsWith("diretta:") === true;
      if (directOutput && source) {
        source = await prepareDirectTrackSource(candidateTrack, source);
        if (token !== currentToken) return;
      }

      const candidateContext = queue.getQueueItem(candidateResult.index)?.context;
      let directGeneration: number | null = null;
      let directDetail: TrackDetail | undefined;
      const directTransitionAllowed =
        status.repeatMode !== "one" && !(status.autoClose.enable && status.autoClose.waitSongEnd);
      const directSeekableSource =
        source !== null &&
        !/^https?:\/\//i.test(source.source) &&
        candidateTrack.cueStartMs == null &&
        candidateTrack.cueEndMs == null;
      if (directOutput && directTransitionAllowed && directSeekableSource && source) {
        nextDirectGeneration = (nextDirectGeneration % 0xffff_ffff) + 1;
        const generation = nextDirectGeneration;
        const staged = await window.api.player.stageDirectNext(
          source.source,
          candidateTrack.duration ?? 0,
          generation,
        );
        if (token !== currentToken) {
          if (staged.success && staged.data?.staged) void window.api.player.cancelDirectNext();
          return;
        }
        if (staged.success && staged.data?.staged) {
          directGeneration = generation;
          directDetail = staged.data.detail;
          activeDirectGeneration = generation;
        }
      }

      cachedResult = {
        trackId: candidateTrack.id,
        track: candidateTrack,
        queueIndex: candidateResult.index,
        context: candidateContext,
        source,
        contextKey,
        directGeneration,
        directDetail,
      };
    } catch (err) {
      console.warn("[nextPreload] Preload task failed silently:", err);
      if (token === currentToken) {
        invalidateNextTrackPreload();
      }
    }
  })();
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
