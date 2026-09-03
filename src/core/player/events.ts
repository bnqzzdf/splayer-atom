import type { PlaybackSessionSnapshot, PlayerEvent, Track } from "@shared/types/player";
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
import { ErrorCode } from "@shared/types/errors";
import { nowPlayingClient } from "@/core/nowPlayingClient";
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

/** session 投影恢复代次；新 session/trackLoaded 会废弃旧的异步核对。 */
let sessionTrackReconcileGeneration = 0;

/** Control 侧只比较 canonical Track 身份，不用标题/封面等可变展示字段判等。 */
const isSameTrackIdentity = (
  left: Track | null | undefined,
  right: Track | null | undefined,
): boolean => {
  if (!left || !right) return left == null && right == null;
  if (left.source !== right.source || left.id !== right.id) return false;
  if (left.source !== "streaming") return true;
  return (left.serverId ?? "") === (right.serverId ?? "");
};

/**
 * 用 Core 已加载的 NowPlaying 状态修复漏失 trackLoaded 后的 Control 展示投影。
 * session.current 可能在真正 load 前就先变化，因此只有两边身份一致时才提交 UI。
 */
const reconcileSessionTrack = async (
  session: PlaybackSessionSnapshot,
  generation: number,
): Promise<void> => {
  const expected = session.current;
  if (!expected) return;
  try {
    const loaded = await nowPlayingClient.getCurrentTrack();
    if (generation !== sessionTrackReconcileGeneration || !loaded) return;
    const status = useStatusStore();
    if (!isSameTrackIdentity(status.currentTrack, expected)) return;
    if (!isSameTrackIdentity(loaded, expected)) return;
    const media = useMediaStore();
    if (isSameTrackIdentity(media.track, expected)) return;

    // trackLoaded 丢失时旧 detail/歌词也属于上一曲；先原子清掉旧 presentation 再恢复已加载 Track。
    media.clear();
    media.setTrack(loaded);
    media.setPlaybackContext(queue.getQueueItem(session.index)?.context);
    status.trackLoading = false;
    status.duration = loaded.duration || status.duration;
    playback.setDuration(status.duration);
    void lyricLoader.loadForTrack(null);
    extractColorFromUrl(loaded.cover ?? loaded.coverOriginal ?? null);
    void coverLoader.loadCoverForTrack(loaded);
    void useHistoryStore().record(loaded);
  } catch {
    // 短暂断线由下一次 session snapshot / WS 重连继续恢复，不制造额外错误状态。
  }
};

/** session 快照只在与当前展示不一致时查询一次已加载状态。 */
const reconcileSessionPresentation = (session: PlaybackSessionSnapshot): void => {
  const generation = ++sessionTrackReconcileGeneration;
  const status = useStatusStore();
  const media = useMediaStore();
  if (!session.current) {
    status.trackLoading = false;
    media.clear();
    return;
  }
  if (isSameTrackIdentity(media.track, session.current)) {
    status.trackLoading = false;
    return;
  }
  // session.current 是 Core 已接受的目标曲，media.track 仍只代表真正加载成功的曲目。
  // 两者不一致时复用现有 loading 状态给 Control 即时反馈，不创建第二套 pending 状态机。
  status.trackLoading = session.active;
  void reconcileSessionTrack(session, generation);
};

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
      sessionTrackReconcileGeneration++;
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
      // Web Control 不接收高频 position event，只轮询 status snapshot；
      // 因此 status 也必须能确认 seek 已到目标，否则 seekTarget 会永久卡住。
      if (!isSeeking() || hasReachedSeekTarget(event.data.position)) {
        const adjusted = playback.setCurrentTime(event.data.position);
        status.position = adjusted;
        // Web 的播放栏歌词同样依赖 status snapshot 推进，不能只等 Desktop position event。
        useMediaStore().updateLyricIndex(adjusted + status.lyricOffsetMs);
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
      status.trackLoading = false;
      if (event.data.error === ErrorCode.OUTPUT_DEVICE_REQUIRED) {
        status.outputSelectionRequest++;
      }
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
      reconcileSessionPresentation(event.data);
      break;
    }
  }
};
