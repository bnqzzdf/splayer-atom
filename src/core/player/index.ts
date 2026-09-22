import type {
  IpcResponse,
  PlaybackContext,
  PlaybackQueueItem,
  PlaybackSessionSnapshot,
  Track,
} from "@shared/types/player";
import type { TagEditRequest, TagWriteOutcome } from "@shared/types/tagEditor";
import type { AlsaPlaybackMode } from "@shared/types/settings";
import { isSameLyricOffsetSource } from "@shared/types/lyrics";
import type { PersonalFmOptions } from "@/types/netease";
import { handleEvent } from "./events";
import type { RepeatMode, ShuffleMode } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { usePluginsStore } from "@/stores/plugins";
import { useHistoryStore } from "@/stores/history";
import { useLibraryStore } from "@/stores/library";
import * as queue from "@/stores/queue";
import {
  isAlsaDirectOutput,
  isDirettaOutput,
  isSampleProcessingUnavailableSelected,
} from "./directMode";
import * as playback from "@/services/playback";
import * as lyricLoader from "@/services/lyric/loader";
import * as autoClose from "@/services/autoClose";
import {
  disposeNextTrackPreload,
  installNextTrackPreloadWatchers,
  scheduleNextTrackPreload,
} from "@/services/nextTrackPreloader";
import { handleError } from "@/utils/errors";
import { toast } from "@/composables/useToast";
import i18n from "@/i18n";
import { coreCommand } from "@/core/controlClient";
import {
  subscribeCoreControlEvent,
  subscribeCorePlayerProjection,
} from "@/core/controlEventClient";
import { sessionClient } from "@/core/sessionClient";
import { playerClient } from "@/core/playerClient";
import { libraryClient } from "@/core/libraryClient";
import { nowPlayingClient } from "@/core/nowPlayingClient";

/** 将 upstream Track 列表包装成共享队列项。 */
const toQueueItems = (items: readonly Track[], context?: PlaybackContext): PlaybackQueueItem[] =>
  items.map((track) => (context ? { track, context } : { track }));

/** 应用主进程返回的权威会话快照。 */
const applySessionResult = (
  result: IpcResponse<PlaybackSessionSnapshot>,
): PlaybackSessionSnapshot | null => {
  if (!result.success || !result.data) return null;
  queue.applySession(result.data);
  const status = useStatusStore();
  status.playIndex = result.data.index;
  status.repeatMode = result.data.repeat;
  status.shuffleMode = result.data.shuffle;
  status.fmMode = result.data.mode === "personalFm";
  autoClose.applySnapshot(result.data.autoClose);
  return result.data;
};

/**
 * 热替换当前播放。
 * canonical Track、fresh source、当前位置与播放态都由 Core PlaybackSession 持有；Control 只发 reload command。
 */
export const reloadCurrentTrack = async (forcePlay?: boolean): Promise<boolean> => {
  const status = useStatusStore();
  if (!status.currentTrack) return false;
  status.trackLoading = true;
  const result = await sessionClient.reloadSessionCurrent(forcePlay);
  if (!result.success || result.data !== true) {
    status.trackLoading = false;
    if (!result.success) handleError(result.error ?? "UNKNOWN");
    return false;
  }
  return true;
};

/** 同一首歌因源失效连续重载的次数，换歌时归零 */
let sourceRecoveryCount = 0;
/** sourceRecoveryCount 对应的 track id */
let sourceRecoveryTrackId: string | null = null;

/**
 * 源失效恢复
 * 重载一次后仍失败则放弃跳曲
 */
export const recoverFromSourceFailure = async (): Promise<void> => {
  const track = useMediaStore().track;
  if (!track) return;
  // 本地文件源失效（文件被删/磁盘错误）没有重载意义，直接跳曲
  if (track.source === "local") {
    await nextTrack();
    return;
  }
  if (sourceRecoveryTrackId !== track.id) {
    sourceRecoveryTrackId = track.id;
    sourceRecoveryCount = 0;
  }
  // 最多重载一次
  if (sourceRecoveryCount >= 1) {
    sourceRecoveryCount = 0;
    await nextTrack();
    return;
  }
  sourceRecoveryCount++;
  // 重载失败（重新解析的 URL 仍失效 / 加载报错，且不会再有 sourceError 兜底）→ 立即跳曲
  const ok = await reloadCurrentTrack(true);
  if (!ok) {
    sourceRecoveryCount = 0;
    await nextTrack();
  }
};

/** 恢复播放 */
export const play = async (): Promise<void> => {
  const status = useStatusStore();
  const prev = status.state;
  status.state = "playing";
  playback.setPlaying(true);
  const result = await coreCommand("/play");
  if (!result.success) {
    status.state = prev;
    playback.setPlaying(false);
    handleError(result.error ?? "UNKNOWN");
  }
};

/** 切换播放/暂停 */
export const togglePlay = (): void => {
  const status = useStatusStore();
  if (status.isPlaying) {
    pause();
  } else {
    play();
  }
};

/** 暂停播放 */
export const pause = async (): Promise<void> => {
  const status = useStatusStore();
  const prev = status.state;
  status.state = "paused";
  playback.setPlaying(false);
  const result = await coreCommand("/pause");
  if (!result.success) {
    status.state = prev;
    playback.setPlaying(true);
  }
};

/** 停止播放并重置进度 */
export const stop = async (): Promise<void> => {
  const status = useStatusStore();
  status.trackLoading = false;
  const result = await coreCommand("/stop");
  if (result.success) {
    status.state = "stopped";
    status.position = 0;
    playback.reset();
  }
};

/**
 * seek 目标位置（毫秒），非 null 表示正在 seek，
 * 后端推送的 position 必须接近此值才会被接受
 */
let seekTarget: number | null = null;

/**
 * 判断后端推送的 position 是否已到达 seek 目标附近
 * @param position - 后端推送的播放位置（毫秒）
 * @returns 是否已到达 seek 目标
 */
export const hasReachedSeekTarget = (position: number): boolean => {
  if (seekTarget === null) return true;
  // 容差：后端推送的位置在 seek 目标 ±1s 内视为已到达
  if (Math.abs(position - seekTarget) < 1000) {
    seekTarget = null;
    playback.setSeeking(false);
    return true;
  }
  return false;
};

/** 当前是否正在 seek */
export const isSeeking = (): boolean => seekTarget !== null;

/**
 * 跳转到指定播放位置
 * @param posMs - 目标位置（毫秒）
 */
export const seek = async (posMs: number): Promise<void> => {
  const status = useStatusStore();
  // 歌曲加载中 seek 无意义：引擎此刻没有可 seek 的解码线程，
  // 且 seekTarget 残留会让加载完成后的 position 推送被持续丢弃
  if (status.trackLoading) return;
  // 先冻结插值，再写入位置
  playback.setSeeking(true);
  status.position = posMs;
  playback.setCurrentTime(posMs);

  // 设置 seek 目标，屏蔽旧 position 推送
  seekTarget = posMs;

  const result = await coreCommand("/seek", { positionMs: posMs });
  if (result.success) {
    status.position = posMs;
    playback.setCurrentTime(posMs);
    return;
  }

  // 命令失败时必须解除 seek 冻结；后续 Core snapshot 会恢复真实位置。
  seekTarget = null;
  playback.setSeeking(false);
  handleError(result.error ?? "UNKNOWN");
};

/**
 * 标记一次非渲染层发起的 seek
 * @param posMs - 目标位置（毫秒）
 */
export const markSeek = (posMs: number): void => {
  const status = useStatusStore();
  if (status.trackLoading) return;
  playback.setSeeking(true);
  status.position = posMs;
  playback.setCurrentTime(posMs);
  seekTarget = posMs;
};

/**
 * 设置音量
 * @param vol - 音量值（0.0 ~ 1.0）
 */
export const setVolume = async (vol: number): Promise<void> => {
  if (isSampleProcessingUnavailableSelected()) return;
  const result = await playerClient.setVolume(vol);
  if (result.success) {
    useStatusStore().volume = vol;
  }
};

/**
 * 设置播放速度
 * @param v - 速度（0.5 ~ 2.0）
 */
export const setSpeed = async (v: number): Promise<void> => {
  if (isSampleProcessingUnavailableSelected()) return;
  const safe = Number.isFinite(v) ? Math.max(0.5, Math.min(2.0, v)) : 1.0;
  const result = await playerClient.setSpeed(safe);
  if (result.success) {
    useStatusStore().speed = safe;
    // 同步给 playback 时间源，让墙钟插值正确换算到源时间
    playback.setSpeed(safe);
  }
};

/**
 * 设置音调偏移（半音 -12 ~ 12）
 */
export const setPitch = async (n: number): Promise<void> => {
  if (isSampleProcessingUnavailableSelected()) return;
  const safe = Number.isFinite(n) ? Math.max(-12, Math.min(12, Math.round(n))) : 0;
  const result = await playerClient.setPitch(safe);
  if (result.success) useStatusStore().pitch = safe;
};

/**
 * 设置"音调同步"开关
 * @param on - true = 变速保音调，false = 变速变调
 */
export const setPitchSync = async (on: boolean): Promise<void> => {
  if (isSampleProcessingUnavailableSelected()) return;
  const result = await playerClient.setPitchSync(on);
  if (result.success) useStatusStore().pitchSync = on;
};

/** 刷新音频输出设备列表 */
export const refreshDevices = async (): Promise<void> => {
  const result = await playerClient.getOutputSnapshot();
  if (!result.success || !result.data) return;
  const status = useStatusStore();
  status.outputDevices = result.data.data;
  status.selectedOutputDevice = result.data.selected;
  status.outputDevicesReady = true;
  const settings = useSettingsStore();
  await settings.syncSystem();
  settings.player.outputDevice = result.data.selected;
  settings.system.player.alsaPlaybackMode = result.data.alsaPlaybackMode;
};

/** 切换 ALSA 的显式 direct / processed 模式；实际事务由 Core 完成。 */
export const switchAlsaPlaybackMode = async (mode: AlsaPlaybackMode): Promise<void> => {
  const settings = useSettingsStore();
  if (settings.system.player.alsaPlaybackMode === mode) return;
  const result = await playerClient.setAlsaPlaybackMode(mode);
  if (!result.success) {
    if (result.error) handleError(result.error);
    return;
  }
  settings.system.player.alsaPlaybackMode = mode;
};

/**
 * 切换音频输出设备
 * @param deviceId - 设备 ID，传 null 表示取消选择
 */
export const switchDevice = async (deviceId: string | null): Promise<void> => {
  const track = useMediaStore().track;
  const settings = useSettingsStore();
  const preparingDirect =
    (isDirettaOutput(deviceId) ||
      isAlsaDirectOutput(deviceId, settings.system.player.alsaPlaybackMode)) &&
    track !== null &&
    track.source !== "local";
  const preparingToast = preparingDirect
    ? toast.loading(i18n.global.t("directMode.preparingSource"), { duration: 0 })
    : null;
  try {
    const result = await playerClient.setOutputDevice(deviceId);
    if (!result.success) {
      if (result.error) handleError(result.error);
      return;
    }
    settings.system.player.outputDevice = deviceId;
    settings.player.outputDevice = deviceId;
    const status = useStatusStore();
    status.selectedOutputDevice = deviceId;
    status.outputDevicesReady = true;
  } finally {
    preparingToast?.close();
  }
};

/**
 * 设置队列并从指定位置开始播放
 * @param items - 歌曲列表
 * @param startIndex - 起始播放位置，默认 0
 * @param context - 队列中曲目共用的播放来源上下文
 */
export const playFrom = async (
  items: readonly Track[],
  startIndex = 0,
  context?: PlaybackContext,
): Promise<void> => {
  if (items.length === 0) return;
  const status = useStatusStore();
  const media = useMediaStore();
  // 退出特殊模式
  status.heartMode = false;
  status.fmMode = false;
  const idx = Math.max(0, Math.min(startIndex, items.length - 1));
  const isSameTrack = media.track?.id === items[idx]?.id;
  const session = applySessionResult(
    await sessionClient.replaceSessionQueue(
      toQueueItems(items, context),
      idx,
      !isSameTrack,
      !isSameTrack,
    ),
  );
  if (!session) return;
  if (isSameTrack && !status.isPlaying) await play();
};

/** 标签写入后由 Core 从 canonical current Track 重新加载，再恢复原进度/播放态。 */
const resumeAfterTagWrite = async (resumeMs: number, wasPlaying: boolean): Promise<void> => {
  const reloaded = await sessionClient.reloadSessionCurrent(false);
  if (!reloaded.success || reloaded.data !== true) return;
  if (resumeMs > 0) await seek(resumeMs);
  if (wasPlaying) await play();
};

/**
 * 写入本地文件标签并同步各处缓存。
 * 目标包含当前播放曲时：记录进度 → 停止释放文件句柄 → 写入 → 重载并恢复进度
 * @param edits - 标签编辑请求（按文件路径）
 * @returns 逐项写入结果；IPC 层失败时返回 null
 */
export const saveTrackTags = async (edits: TagEditRequest[]): Promise<TagWriteOutcome[] | null> => {
  if (edits.length === 0) return [];
  const media = useMediaStore();
  const status = useStatusStore();
  const current = media.track;
  const currentPath = current?.source === "local" ? current.path : undefined;
  const touchesCurrent = !!currentPath && edits.some((edit) => edit.path === currentPath);

  let resumeMs = 0;
  let wasPlaying = false;
  if (touchesCurrent) {
    resumeMs = Math.round(playback.getCurrentTime());
    wasPlaying = status.isPlaying;
    // Windows 下引擎持有文件句柄，必须先停止才能写入
    await coreCommand("/stop");
  }

  const result = await libraryClient.writeTags(edits);
  if (!result.success || !result.data) {
    if (result.error) handleError(result.error);
    // 写入失败也要恢复被停掉的当前曲
    if (touchesCurrent && current) await resumeAfterTagWrite(resumeMs, wasPlaying);
    return null;
  }

  const updated = result.data
    .filter((outcome) => outcome.success && outcome.track)
    .map((outcome) => outcome.track!);
  if (updated.length > 0) {
    useLibraryStore().applyTrackUpdates(updated);
    applySessionResult(await sessionClient.updateSessionQueueTracks(updated));
  }

  if (touchesCurrent && current) {
    await resumeAfterTagWrite(resumeMs, wasPlaying);
  }
  return result.data;
};

/**
 * 进入心动模式：用智能推荐列表替换队列并从头播放
 * @param tracks - 网易云智能推荐曲目
 */
export const playHeartMode = async (tracks: readonly Track[]): Promise<void> => {
  if (tracks.length === 0) return;
  const status = useStatusStore();
  applySessionResult(await sessionClient.replaceSessionQueue(toQueueItems(tracks), 0, true, true));
  if (status.shuffleMode !== "off") {
    applySessionResult(await sessionClient.setSessionShuffle("off"));
  }
  status.heartMode = true;
  // 心动 / FM 互斥
  status.fmMode = false;
};

/** 退出心动模式，保留当前队列继续播放 */
export const exitHeartMode = (): void => {
  useStatusStore().heartMode = false;
};

/**
 * 启动私人 FM 播放
 * @param options - 可选的 FM 模式与场景选项
 * @returns 是否成功进入并开始播放
 */
export const playPersonalFm = async (options?: PersonalFmOptions): Promise<boolean> => {
  const status = useStatusStore();
  const session = applySessionResult(await sessionClient.startPersonalFm(options, true));
  if (!session?.current || session.mode !== "personalFm") return false;
  // 心动 / FM 互斥；FM authority 由 Core session.mode 投影。
  status.heartMode = false;
  return true;
};

/**
 * 标记当前私人 FM 曲目为不喜欢并切到下一首
 */
export const dislikeFmTrack = async (): Promise<void> => {
  if (!useStatusStore().fmMode) return;
  const playedSec = Math.max(0, Math.round(playback.getCurrentTime() / 1000));
  applySessionResult(await sessionClient.dislikePersonalFm(playedSec));
};

/**
 * 播放下一首
 */
export const reloadCurrentQueueTrack = async (): Promise<void> => {
  await reloadCurrentTrack(true);
};

export const nextTrack = async (): Promise<void> => {
  if (queue.queueLength.value === 0) return;
  applySessionResult(await sessionClient.nextSession(true));
};

/**
 * 跳到队列指定位置并播放
 * 同一首则不重新加载，仅在暂停时恢复播放
 * @param index - 队列位置
 */
export const playAtIndex = async (index: number): Promise<void> => {
  const status = useStatusStore();
  if (index < 0 || index >= queue.queueLength.value) return;
  if (index === status.playIndex) {
    if (!status.isPlaying && useMediaStore().track) play();
    return;
  }
  // 退出 FM
  status.fmMode = false;
  applySessionResult(await sessionClient.selectSessionIndex(index, true, true));
};

/** 播放上一首，首位时回绕到末尾 */
export const prevTrack = async (): Promise<void> => {
  const status = useStatusStore();
  if (status.fmMode) return;
  if (queue.queueLength.value === 0) return;
  applySessionResult(await sessionClient.prevSession(true));
};

/** 队列播放结束，通知主进程停止并更新状态 */
const onQueueEnded = async (): Promise<void> => {
  const status = useStatusStore();
  status.trackLoading = false;
  playback.setPlaying(false);
  playback.reset();
  // 通过共享 Core Protocol 停止音频引擎
  await coreCommand("/stop");
  status.state = "stopped";
  status.position = status.duration;
};

/**
 * 设置循环模式
 * @param mode - off（不循环）、list（列表循环）、one（单曲循环）
 */
export const setRepeatMode = (mode: RepeatMode): void => {
  const status = useStatusStore();
  if (status.repeatMode === mode) return;
  void sessionClient.setSessionRepeat(mode).then((result) => {
    if (!applySessionResult(result)) return;
    toast.info(i18n.global.t(`player.repeatMode.${mode}`), { icon: false });
  });
};

/** 循环切换循环模式：off → list → one → off */
export const cycleRepeatMode = (): void => {
  const status = useStatusStore();
  const cycle: RepeatMode[] = ["off", "list", "one"];
  const nextIndex = (cycle.indexOf(status.repeatMode) + 1) % cycle.length;
  setRepeatMode(cycle[nextIndex]);
};

/** 切换随机模式 */
export const toggleShuffleMode = (): void => {
  const status = useStatusStore();
  setShuffleMode(status.shuffleMode === "on" ? "off" : "on");
};

/**
 * 设置随机模式，开启时洗牌队列，关闭时恢复原始顺序
 * @param mode - off（顺序）、on（随机）
 */
export const setShuffleMode = (mode: ShuffleMode): void => {
  const status = useStatusStore();
  // 心动模式下忽略
  if (status.heartMode || status.shuffleMode === mode) return;
  void sessionClient.setSessionShuffle(mode).then((result) => {
    if (!applySessionResult(result)) return;
    toast.info(i18n.global.t(`player.shuffleMode.${mode}`), { icon: false });
  });
};

/** 清空权威播放队列并停止当前播放。 */
export const clearQueue = async (): Promise<void> => {
  const session = applySessionResult(await sessionClient.clearSessionQueue(true));
  if (!session) return;
  const status = useStatusStore();
  status.state = "stopped";
  status.position = 0;
  playback.reset();
};

/**
 * 从队列移除指定位置的歌曲，自动调整 playIndex
 * @param index - 要移除的队列位置
 */
export const removeFromQueue = async (index: number): Promise<void> => {
  const status = useStatusStore();
  if (index < 0 || index >= queue.queueLength.value) return;
  const isCurrentPlaying = index === status.playIndex;
  const session = applySessionResult(
    await sessionClient.removeSessionQueueIndex(index, isCurrentPlaying),
  );
  if (!session) return;
  if (session.queue.length === 0) {
    await onQueueEnded();
    return;
  }
};

/**
 * 插入歌曲到队列指定位置，自动调整 playIndex
 * 队列中已有同 ID 歌曲时移动到目标位置
 * @param item - 要插入的歌曲
 * @param afterIndex - 插入到此索引之后，默认为当前播放位置之后
 * @param context - 播放来源上下文
 * @returns 歌曲在队列中的实际索引
 */
export const insertToQueue = async (
  item: Track,
  afterIndex?: number,
  context?: PlaybackContext,
): Promise<number> => {
  const status = useStatusStore();
  const len = queue.queue.value.length;
  const raw = afterIndex ?? status.playIndex + 1;
  const existingIdx = queue.findTrackIndex(item.id);
  const entry = toQueueItems([item], context)[0];
  if (existingIdx !== -1) {
    if (!applySessionResult(await sessionClient.updateSessionQueueItem(existingIdx, entry))) {
      return existingIdx;
    }
    const safeAt = Math.max(0, Math.min(raw, len - 1));
    if (existingIdx === safeAt) return existingIdx;
    if (!applySessionResult(await sessionClient.moveSessionQueue(existingIdx, safeAt))) {
      return existingIdx;
    }
    return safeAt;
  }
  const safeAt = Math.max(0, Math.min(raw, len));
  if (!applySessionResult(await sessionClient.insertSessionQueue([entry], safeAt))) {
    return -1;
  }
  return safeAt;
};

/**
 * 批量插入曲目，一次性切片落盘，避免逐首插入的卡顿
 * 跳过队列中已存在的（含当前播放曲目）与传入列表内部的重复
 * @param items - 要插入的曲目
 * @param position - 插入到当前曲目之后或队列末尾
 * @param context - 播放来源上下文
 * @returns 实际插入的数量
 */
export const insertManyToQueue = (
  items: readonly Track[],
  position: "next" | "end" = "next",
  context?: PlaybackContext,
): number => {
  if (items.length === 0) return 0;
  const status = useStatusStore();
  const seen = new Set(queue.queue.value.map((track) => track.id));
  const fresh: Track[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    fresh.push(item);
  }
  if (fresh.length === 0) return 0;
  const insertAt = position === "end" ? queue.queue.value.length : status.playIndex + 1;
  void sessionClient
    .insertSessionQueue(toQueueItems(fresh, context), insertAt)
    .then((result) => applySessionResult(result))
    .catch((error) => console.error("[player] 批量插入权威队列失败:", error));
  return fresh.length;
};

/**
 * 插入歌曲到当前位置之后并立即播放
 * 如果是当前正在播放的歌曲则继续播放，不重新加载
 */
export const playNow = async (item: Track, context?: PlaybackContext): Promise<void> => {
  const status = useStatusStore();
  const media = useMediaStore();
  // 同一首歌且已成功加载
  if (media.track?.id === item.id && status.currentSource) {
    if (!status.isPlaying) play();
    return;
  }
  // 退出 FM
  status.fmMode = false;
  const insertedIndex = await insertToQueue(item, undefined, context);
  if (insertedIndex < 0) return;
  applySessionResult(await sessionClient.selectSessionIndex(insertedIndex, true, true));
};

/** 将本地音频路径转换为可交给 Core 的轻量 Track。 */
export const createLocalTrack = (filePath: string): Track => {
  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  return {
    id: `local:${filePath}`,
    title: fileName.replace(/\.[^/.]+$/, ""),
    artists: [],
    source: "local",
    path: filePath,
    duration: 0,
  };
};

/** 将一组外部本地文件交给 Core 替换队列并从首项开始播放。 */
export const playFiles = async (filePaths: string[]): Promise<void> => {
  if (filePaths.length === 0) return;
  await playFrom(filePaths.map(createLocalTrack), 0, {
    originId: "local-files",
    originType: "track",
    originName: "本地文件",
  });
};

/**
 * 移动队列中的歌曲位置，自动调整 playIndex
 * @param fromIndex - 原位置
 * @param toIndex - 目标位置
 */
export const moveInQueue = async (fromIndex: number, toIndex: number): Promise<void> => {
  applySessionResult(await sessionClient.moveSessionQueue(fromIndex, toIndex));
};

let unsubscribeCoreProjection: (() => void) | null = null;
let unsubscribeLyricOffset: (() => void) | null = null;
let initialized = false;

/** 初始化播放器 */
export const initPlayer = async (): Promise<void> => {
  if (initialized) return;
  initialized = true;
  console.log("[player] init");
  await useSettingsStore().syncSystem();
  // 插件列表来自同一 Core registry，在建立播放投影前开始加载。
  void usePluginsStore().load();
  const status = useStatusStore();
  const session = await queue.restoreQueue();
  if (session) {
    status.playIndex = session.index;
    status.repeatMode = session.repeat;
    status.shuffleMode = session.shuffle;
    status.fmMode = session.mode === "personalFm";
    autoClose.applySnapshot(session.autoClose);
  }

  unsubscribeCoreProjection?.();
  unsubscribeCoreProjection = subscribeCorePlayerProjection(handleEvent);
  unsubscribeLyricOffset?.();
  unsubscribeLyricOffset = subscribeCoreControlEvent(
    "lyricOffset",
    ({ trackId, source, offsetMs }) => {
      const media = useMediaStore();
      if (media.track?.id !== trackId) return;
      if (!isSameLyricOffsetSource(media.activeLyric, source)) return;
      status.lyricOffsetMs = offsetMs;
      media.updateLyricIndex(playback.getCurrentTime() + offsetMs);
    },
  );

  await refreshDevices();
  const media = useMediaStore();
  const current = status.currentTrack;
  if (current) {
    let loaded = null;
    try {
      loaded = await nowPlayingClient.getCurrentPlayback();
    } catch (error) {
      console.error("[player] getCurrentPlayback failed", error);
    }
    media.setTrack(loaded?.track ?? current, loaded?.detail ?? undefined);
    media.setPlaybackContext(status.currentPlaybackContext);
    void lyricLoader.loadForTrack(loaded?.detail ?? null);
  }

  const currentStatus = await playerClient.getStatus();
  if (currentStatus.success && currentStatus.data) {
    status.state =
      current && currentStatus.data.state === "idle" ? "stopped" : currentStatus.data.state;
    status.position = currentStatus.data.position;
    status.duration = currentStatus.data.duration;
    status.volume = currentStatus.data.volume;
    status.speed = currentStatus.data.speed;
    playback.setCurrentTime(currentStatus.data.position, { force: true });
    playback.setDuration(currentStatus.data.duration);
    playback.setSpeed(currentStatus.data.speed);
    playback.setPlaying(currentStatus.data.state === "playing");
    if (
      current &&
      (currentStatus.data.state === "playing" || currentStatus.data.state === "paused")
    ) {
      // Web Control 可能在 Core 已经播放后才连入，补齐 renderer 历史投影。
      void useHistoryStore().record(current);
    }
  }

  installNextTrackPreloadWatchers();
  scheduleNextTrackPreload();
};

/** 清理事件订阅 */
export const disposePlayer = (): void => {
  disposeNextTrackPreload();
  if (unsubscribeCoreProjection) {
    unsubscribeCoreProjection();
    unsubscribeCoreProjection = null;
  }
  if (unsubscribeLyricOffset) {
    unsubscribeLyricOffset();
    unsubscribeLyricOffset = null;
  }
};
