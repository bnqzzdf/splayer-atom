import type { PlayerEvent } from "@shared/types/player";
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import { useHistoryStore } from "@/stores/history";
import * as queue from "@/stores/queue";
import { useFavorite } from "@/composables/useFavorite";
import { isWebRemote } from "@/runtime";
import * as playback from "@/services/playback";
import * as autoClose from "@/services/autoClose";
import * as abLoop from "@/services/abLoop";
import * as cacheScheduler from "@/services/cacheScheduler";
import * as playStats from "./stats";
import { consumeDirectGaplessBoundary } from "@/services/nextTrackPreloader";
import {
  commitDirectGaplessTrack,
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
    // 结算播放统计
    playStats.onTrackEnded(repeatOne && !stopByTimer);
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
    case "ended": {
      // Headless main session 已经消费自然结束；远程 Web 只等待 session 快照更新。
      if (!isWebRemote()) await finishCurrentTrack();
      break;
    }
    case "directTrackBoundary": {
      // Node Core 已消费 staged boundary；远程 Web 只等待 session 快照，不参与 gapless ownership。
      if (isWebRemote()) break;
      const preloaded = consumeDirectGaplessBoundary(event.data.generation);
      if (!preloaded) {
        // native 已经跨过边界但 renderer 上下文已变化：显式重建当前应播放的队列语义。
        const stopByTimer = autoClose.onTrackEnded();
        const repeatOne = status.repeatMode === "one" && !status.fmMode;
        playStats.onTrackEnded(repeatOne && !stopByTimer);
        await stop();
        if (stopByTimer) break;
        if (repeatOne) {
          await reloadCurrentQueueTrack();
        } else {
          await nextTrack();
        }
        break;
      }

      const stopByTimer = autoClose.onTrackEnded();
      playStats.onTrackEnded(false);
      if (stopByTimer) {
        await stop();
        break;
      }

      if (!(await commitDirectGaplessTrack(preloaded))) {
        await stop();
        await nextTrack();
      }
      break;
    }
    case "sourceError":
      // Headless main session 会在音源失败时自行推进权威队列。
      if (!isWebRemote()) await recoverFromSourceFailure();
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
      const previousTrackId = useMediaStore().track?.id;
      queue.applySession(event.data);
      const status = useStatusStore();
      status.playIndex = event.data.index;
      status.repeatMode = event.data.repeat;
      status.shuffleMode = event.data.shuffle;
      if (isWebRemote() && event.data.current?.id !== previousTrackId) {
        const media = useMediaStore();
        if (event.data.current) {
          media.setTrack(event.data.current);
          media.setPlaybackContext(queue.getQueueItem(event.data.index)?.context);
          // Headless 自动切歌由主进程驱动，Web 仍复用 upstream 播放历史 store 记录新曲。
          void useHistoryStore().record(event.data.current);
        } else {
          media.clear();
        }
      }
      break;
    }
  }
};
