import type { PlayerEvent } from "@shared/types/player";
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import { useHistoryStore } from "@/stores/history";
import * as queue from "@/stores/queue";
import { useFavorite } from "@/composables/useFavorite";
import * as playback from "@/services/playback";
import * as autoClose from "@/services/autoClose";
import * as abLoop from "@/services/abLoop";
import * as cacheScheduler from "@/services/cacheScheduler";
import * as lyricLoader from "@/services/lyric/loader";
import * as coverLoader from "@/services/coverLoader";
import { extractColorFromUrl } from "@/utils/color";
import { handleError } from "@/utils/errors";
import {
  hasReachedSeekTarget,
  insertManyToQueue,
  isSeeking,
  markSeek,
  nextTrack,
  pause,
  play,
  playNow,
  prevTrack,
  recoverFromSourceFailure,
  refreshDevices,
  reloadCurrentQueueTrack,
  seek,
  setRepeatMode,
  setShuffleMode,
  stop,
} from "./index";

/** 防止 ended 事件重入 */
let endedGuard = false;

/** 按当前播放模式结算并进入下一步 */
const finishCurrentTrack = async (): Promise<void> => {
  const status = useStatusStore();
  if (endedGuard) return;
  endedGuard = true;
  try {
    const stopByTimer = autoClose.onTrackEnded();
    // FM 模式跳过
    const repeatOne = status.repeatMode === "one" && !status.fmMode;
    // 定时关闭"等本曲结束"模式
    if (stopByTimer) return;
    // 单曲循环：seek 回开头继续播放
    if (repeatOne) {
      await seek(0);
      await play();
    } else {
      await nextTrack();
    }
  } finally {
    endedGuard = false;
  }
};

/**
 * 处理主进程推送的播放事件
 * @param event - 播放事件
 */
export const handleEvent = async (event: PlayerEvent): Promise<void> => {
  const status = useStatusStore();
  switch (event.type) {
    case "trackLoaded": {
      const media = useMediaStore();
      media.setTrack(event.data.track, event.data.detail);
      media.setPlaybackContext(event.data.context);
      if (event.data.mediaInfo) media.enrichTrack(event.data.mediaInfo, event.data.detail);
      const projectedTrack = media.track ?? event.data.track;
      status.currentSource = event.data.source;
      status.duration = projectedTrack.duration || event.data.mediaInfo?.duration || 0;
      status.state = event.data.autoPlay ? "playing" : "paused";
      status.trackLoading = false;
      playback.setCurrentTime(0, { force: true });
      playback.setDuration(status.duration);
      playback.setPlaying(event.data.autoPlay);
      cacheScheduler.cancel();
      void lyricLoader.loadForTrack(event.data.detail ?? null);
      extractColorFromUrl(projectedTrack.cover ?? projectedTrack.coverOriginal ?? null);
      void coverLoader.loadCoverForTrack(projectedTrack);
      void useHistoryStore().record(projectedTrack);
      break;
    }
    case "status":
      // 歌曲加载中或 loading 事件不更新 UI，保持当前封面/进度/播放状态平滑过渡
      if (event.data.state === "loading" || status.trackLoading) break;
      status.state = event.data.state;
      // seek 期间不从 status 事件更新 position，避免回跳；position 更新统一由 position 事件负责
      if (!isSeeking()) {
        status.position = playback.setCurrentTime(event.data.position);
      }
      status.duration = event.data.duration;
      status.volume = event.data.volume;
      if (event.data.speed != null) {
        status.speed = event.data.speed;
        playback.setSpeed(event.data.speed);
      }
      playback.setDuration(event.data.duration);
      playback.setPlaying(event.data.state === "playing");
      break;
    case "seek":
      markSeek(event.data.position);
      break;
    case "position": {
      // 歌曲加载中不更新进度
      if (status.trackLoading) break;
      // seek 后丢弃旧位置，直到后端推送的位置到达 seek 目标附近
      if (!hasReachedSeekTarget(event.data.position)) break;
      const adjusted = playback.setCurrentTime(event.data.position);
      status.position = adjusted;
      if (event.data.duration > 0) {
        status.duration = event.data.duration;
        playback.setDuration(event.data.duration);
      }
      // 歌词索引叠加用户设置的偏移；进度条仍走 adjusted 不受影响
      useMediaStore().updateLyricIndex(adjusted + status.lyricOffsetMs);
      // AB 循环：到达 B 点 seek 回 A
      abLoop.checkLoop(adjusted);
      // 推进延时缓存调度
      cacheScheduler.tick(adjusted);
      const track = useMediaStore().track;
      if (track?.cueEndMs != null && status.isPlaying && status.duration > 0) {
        if (adjusted >= status.duration - 250) await finishCurrentTrack();
      }
      break;
    }
    case "fftData":
      playback.setFftFrame(event.data.ldata, event.data.rdata);
      break;
    case "error":
      handleError(event.data.error);
      break;
    case "ended": {
      // 只有 Core 未消费自然结束时，Desktop legacy fallback 才会进入这里。
      await finishCurrentTrack();
      break;
    }
    case "directTrackBoundary": {
      // Core 正常消费 staged boundary；只有未消费的异常边界才会到 Desktop renderer。
      // renderer 不再持有 Direct generation/source 第二状态机，只按当前队列语义安全恢复。
      const stopByTimer = autoClose.onTrackEnded();
      const repeatOne = status.repeatMode === "one" && !status.fmMode;
      await stop();
      if (stopByTimer) break;
      if (repeatOne) {
        await reloadCurrentQueueTrack();
      } else {
        await nextTrack();
      }
      break;
    }
    case "sourceError":
      // 只有 Core 未消费音源失败时，Desktop legacy fallback 才会进入这里。
      await recoverFromSourceFailure();
      break;
    case "play":
      await play();
      break;
    case "playTrack":
      await playNow(event.data.track);
      break;
    case "pause":
      await pause();
      break;
    case "next":
      await nextTrack();
      break;
    case "prev":
      await prevTrack();
      break;
    case "setShuffle":
      setShuffleMode(event.data.mode);
      break;
    case "setRepeat":
      setRepeatMode(event.data.mode);
      break;
    case "addToQueue":
      insertManyToQueue(event.data.tracks, event.data.position);
      break;
    case "toggleLike":
      await useFavorite().toggle(useMediaStore().track);
      break;
    case "deviceChanged": {
      refreshDevices();
      break;
    }
    case "session": {
      queue.applySession(event.data);
      const status = useStatusStore();
      status.playIndex = event.data.index;
      status.repeatMode = event.data.repeat;
      status.shuffleMode = event.data.shuffle;
      status.fmMode = event.data.mode === "personalFm";
      autoClose.applySnapshot(event.data.autoClose);
      if (!event.data.current) useMediaStore().clear();
      break;
    }
  }
};
