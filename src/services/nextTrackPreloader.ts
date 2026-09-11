/**
 * 下一首歌曲展示资源预载服务。
 *
 * 播放输入解析、缓存与 Diretta staging 由 Core playbackPreloader 唯一持有；
 * renderer 只利用 Chromium 预热下一首歌词与封面。
 */

import { getNextTrackCandidate } from "@/core/player/candidate";
import { invalidatePreloadedLyric, preloadLyricForTrack } from "@/services/lyric/preload";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { useMediaStore } from "@/stores/media";
import * as queue from "@/stores/queue";

let pendingCover: HTMLImageElement | null = null;
let stopContextWatch: (() => void) | null = null;

/** 提前解码封面图片，仅利用 Chromium 渲染引擎缓存。 */
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
    // 展示资源预热失败不影响播放。
  } finally {
    if (pendingCover === image) pendingCover = null;
  }
};

/** 作废 renderer 展示资源预载。 */
export const invalidateNextTrackPreload = (): void => {
  if (pendingCover) {
    pendingCover.src = "";
    pendingCover = null;
  }
  invalidatePreloadedLyric();
};

/** 调度下一首歌词与封面预热；播放输入与 Direct staging 始终留在 Core。 */
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

  const candidate = getNextTrackCandidate({
    playIndex: status.playIndex,
    queue: queue.queue.value,
    fmMode: status.fmMode,
    fuckDjMode: settings.system.player.fuckDjMode,
    shuffleMode: status.shuffleMode,
    repeatMode: status.repeatMode,
  });
  if (!candidate) {
    invalidateNextTrackPreload();
    return;
  }

  preloadLyricForTrack(candidate.track);
  if (candidate.track.cover) void preloadCover(candidate.track.cover);
};

/** 安装展示资源预载上下文监听。 */
export const installNextTrackPreloadWatchers = (): void => {
  if (stopContextWatch) return;
  const settings = useSettingsStore();
  const status = useStatusStore();
  stopContextWatch = watch(
    () => [
      settings.system.player.preloadNextTrack,
      settings.system.player.fuckDjMode,
      status.currentTrack?.id,
      status.playIndex,
      status.fmMode,
      status.shuffleMode,
      status.repeatMode,
      queue.queue.value,
      settings.lyric.lyricSourcePreference,
      settings.lyric.lyricSourceOrder.join(","),
      settings.lyric.lyricFormatOrder.join(","),
      settings.lyric.smartPreferOnline,
      settings.lyric.preferPluginLyric,
      settings.system.lyric.enableOnlineTTMLLyric,
      settings.system.localLyric.enableLocalTTMLOverride,
      settings.system.localLyric.repoDir,
    ],
    scheduleNextTrackPreload,
    { flush: "post" },
  );
};

/** 清理展示资源预载上下文监听。 */
export const disposeNextTrackPreload = (): void => {
  stopContextWatch?.();
  stopContextWatch = null;
  invalidateNextTrackPreload();
};
