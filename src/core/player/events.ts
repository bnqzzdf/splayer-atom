import type { CorePlayerProjectionEvent } from "@shared/types/coreEvents";
import type { PlaybackSessionSnapshot, Track } from "@shared/types/player";
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import { useHistoryStore } from "@/stores/history";
import * as queue from "@/stores/queue";
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
import { hasReachedSeekTarget, isSeeking, refreshDevices } from "./index";

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

/**
 * 处理 Core 推送的权威播放投影
 * @param event - 播放事件
 */
export const handleEvent = async (event: CorePlayerProjectionEvent): Promise<void> => {
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
        // 播放栏歌词依赖 status snapshot 推进，不能只等待稀疏 position event。
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
