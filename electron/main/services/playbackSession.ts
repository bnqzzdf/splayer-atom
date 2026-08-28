import type {
  AudioDevice,
  PlaybackQueueItem,
  PlaybackSessionSnapshot,
  RepeatMode,
  ShuffleMode,
  Track,
} from "@shared/types/player";
import { getPlayer } from "@main/services/engine";
import { loadPlaybackSession, savePlaybackSession } from "@main/database/playbackSession";
import * as nowPlaying from "@main/services/nowPlaying";
import { loadPlayerSource } from "@main/services/playerLoad";
import { clearActiveCueRange, toEnginePositionMs } from "@main/services/playerTimeline";
import { wsBroadcast } from "@main/server/broadcast";
import { isHeadlessMode } from "@main/runtime";
import { store } from "@main/store";
import { publishDesktopEvent } from "@main/atom/runtime/events";
import { playerLog } from "@main/utils/logger";

let queue: PlaybackQueueItem[] = [];
let originalQueue: PlaybackQueueItem[] | null = null;
let index = -1;
let repeat: RepeatMode = "list";
let shuffle: ShuffleMode = "off";
let active = false;
let initialized = false;
let loadGeneration = 0;

/** Linux headless Diretta Host requires root privileges in the supported deployment model. */
const assertHeadlessDirettaPrivilege = (deviceId: string | null | undefined): void => {
  if (
    isHeadlessMode() &&
    process.platform === "linux" &&
    deviceId?.startsWith("diretta:") === true &&
    typeof process.getuid === "function" &&
    process.getuid() !== 0
  ) {
    throw new Error("Diretta Headless on Linux requires root privileges");
  }
};

const cloneQueue = (items: PlaybackQueueItem[]): PlaybackQueueItem[] =>
  items.map((item) => ({ ...item, track: { ...item.track } }));

const snapshot = (): PlaybackSessionSnapshot => ({
  active,
  queue: cloneQueue(queue),
  originalQueue: originalQueue ? cloneQueue(originalQueue) : null,
  index,
  current: index >= 0 && index < queue.length ? { ...queue[index].track } : null,
  repeat,
  shuffle,
});

const publish = (): void => {
  const data = snapshot();
  savePlaybackSession(data);
  publishDesktopEvent("player:event", { type: "session", data });
  wsBroadcast({ type: "session", data });
};

const requireLocalSource = (track: Track): string => {
  if (track.source !== "local") {
    throw new Error(`Headless phase-1 playback only accepts local tracks, got: ${track.source}`);
  }
  const source = track.cueAudioPath ?? track.path;
  if (!source) throw new Error(`Local track has no playable path: ${track.id}`);
  return source;
};

const loadIndex = async (targetIndex: number, autoPlay = true): Promise<void> => {
  if (targetIndex < 0 || targetIndex >= queue.length) throw new Error("queue index out of range");
  const generation = ++loadGeneration;
  const item = queue[targetIndex];
  const track = item.track;
  const source = requireLocalSource(track);

  playerLog.info(`[session] load local track: ${track.title}`);
  const result = await loadPlayerSource(source, {
    autoPlay,
    meta: track,
    context: item.context,
  });
  if (generation !== loadGeneration) return;
  if (!result.success || !result.data) {
    throw new Error(`local session load failed: ${result.error ?? "UNKNOWN"}`);
  }

  index = targetIndex;
  active = true;
  const duration = Math.max(track.duration || 0, result.data.mediaInfo.duration);
  nowPlaying.update({ ...track, duration }, [], null);
  nowPlaying.onPosition(0, autoPlay);
  nowPlaying.onPlayStateChange(autoPlay ? "playing" : "paused");
};

export const initPlaybackSession = async (): Promise<void> => {
  if (initialized) return;
  initialized = true;
  const persisted = loadPlaybackSession();
  if (persisted) {
    queue = cloneQueue(persisted.queue);
    originalQueue = persisted.originalQueue ? cloneQueue(persisted.originalQueue) : null;
    index = persisted.index;
    repeat = persisted.repeat;
    shuffle = persisted.shuffle;
    active = queue.length > 0;
  }
  const player = getPlayer();
  // Headless 使用与桌面相同的持久化样本域设置。
  player.setVolume(store.get("player.volume"));
  player.setNormalizationEnabled(store.get("player.loudnessNormalization"));
  player.setEqualizerEnabled(store.get("player.equalizer.enabled"));
  player.setEqualizerBands(store.get("player.equalizer.bands"));
  player.setPreampGain(store.get("player.equalizer.preamp"));
  player.setFadeDuration(store.get("player.fadeEnabled") ? store.get("player.fadeDuration") : 0);
  const output = store.get("player.outputDevice");
  if (output) {
    try {
      assertHeadlessDirettaPrivilege(output);
      await player.setOutputDevice(output);
    } catch (error) {
      playerLog.warn(`[session] persisted output not activated: ${String(error)}`);
    }
  }
};

export const getPlaybackSession = (): PlaybackSessionSnapshot => snapshot();

/** 一次性接收旧 renderer IndexedDB 队列；已有 main session 时绝不覆盖。 */
export const migrateLegacyQueue = (
  items: PlaybackQueueItem[],
  legacyOriginalQueue: PlaybackQueueItem[] | null,
  legacyIndex: number,
  legacyRepeat: RepeatMode,
  legacyShuffle: ShuffleMode,
): PlaybackSessionSnapshot => {
  if (queue.length > 0) return snapshot();
  queue = cloneQueue(items);
  originalQueue =
    legacyShuffle === "on" && legacyOriginalQueue ? cloneQueue(legacyOriginalQueue) : null;
  index = queue.length === 0 ? -1 : Math.max(0, Math.min(legacyIndex, queue.length - 1));
  repeat = legacyRepeat;
  shuffle = legacyShuffle;
  active = queue.length > 0;
  publish();
  return snapshot();
};

export const ownsPlayback = (): boolean => active && queue.length > 0;

/** 保持当前曲在首位并随机其余队列；originalQueue 始终保留未随机顺序。 */
const shuffleKeepingCurrent = (): void => {
  if (queue.length <= 1) {
    index = queue.length === 1 ? 0 : -1;
    return;
  }
  const safeIndex = index >= 0 && index < queue.length ? index : 0;
  const current = queue[safeIndex];
  const rest = queue.filter((_, itemIndex) => itemIndex !== safeIndex);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  queue = [current, ...rest];
  index = 0;
};

export const replaceQueue = async (
  items: PlaybackQueueItem[],
  startIndex = 0,
  autoPlay = true,
  loadCurrent = true,
): Promise<PlaybackSessionSnapshot> => {
  if (items.length === 0) {
    await clearQueue(loadCurrent);
    return snapshot();
  }
  queue = cloneQueue(items);
  originalQueue = null;
  index = Math.max(0, Math.min(startIndex, queue.length - 1));
  if (shuffle === "on") {
    originalQueue = cloneQueue(queue);
    shuffleKeepingCurrent();
  }
  active = true;
  publish();
  if (loadCurrent) await loadIndex(index, autoPlay);
  return snapshot();
};

export const playTrack = async (track: Track, autoPlay = true): Promise<PlaybackSessionSnapshot> =>
  replaceQueue([{ track }], 0, autoPlay);

export const appendQueue = (items: PlaybackQueueItem[]): PlaybackSessionSnapshot => {
  queue.push(...cloneQueue(items));
  if (originalQueue) originalQueue.push(...cloneQueue(items));
  if (queue.length > 0) active = true;
  publish();
  return snapshot();
};

export const insertQueue = (
  items: PlaybackQueueItem[],
  insertIndex: number,
): PlaybackSessionSnapshot => {
  if (items.length === 0) return snapshot();
  const safeIndex = Math.max(0, Math.min(insertIndex, queue.length));
  const entries = cloneQueue(items);
  queue.splice(safeIndex, 0, ...entries);
  if (safeIndex <= index) index += entries.length;
  if (originalQueue) originalQueue.push(...cloneQueue(items));
  active = queue.length > 0;
  publish();
  return snapshot();
};

export const removeQueueIndex = async (
  removeIndex: number,
  loadCurrent = true,
): Promise<PlaybackSessionSnapshot> => {
  if (removeIndex < 0 || removeIndex >= queue.length) return snapshot();
  const removingCurrent = removeIndex === index;
  const [removed] = queue.splice(removeIndex, 1);
  if (queue.length === 0) {
    await clearQueue(true);
    return snapshot();
  }
  if (removeIndex < index) index--;
  if (originalQueue && removed) {
    originalQueue = originalQueue.filter((item) => item.track.id !== removed.track.id);
  }
  if (removingCurrent) {
    index = Math.min(removeIndex, queue.length - 1);
    publish();
    if (loadCurrent) await loadIndex(index, true);
  } else {
    publish();
  }
  return snapshot();
};

export const clearQueue = async (stop = false): Promise<void> => {
  ++loadGeneration;
  queue = [];
  originalQueue = null;
  index = -1;
  active = false;
  nowPlaying.clear();
  clearActiveCueRange();
  if (stop) getPlayer().stop();
  publish();
};

export const play = async (): Promise<void> => {
  if (queue.length > 0 && (index < 0 || getPlayer().getStatus().state === "stopped")) {
    await loadIndex(Math.max(0, index), true);
    return;
  }
  await getPlayer().play();
};

export const pause = (): void => getPlayer().pause();
export const stop = (): void => getPlayer().stop();
export const seek = (positionMs: number): Promise<void> =>
  getPlayer().seek(toEnginePositionMs(Math.max(0, positionMs)) / 1000);

export const selectIndex = async (
  targetIndex: number,
  loadCurrent = true,
  autoPlay = true,
): Promise<PlaybackSessionSnapshot> => {
  if (targetIndex < 0 || targetIndex >= queue.length) return snapshot();
  index = targetIndex;
  active = true;
  publish();
  if (loadCurrent) await loadIndex(index, autoPlay);
  return snapshot();
};

export const next = async (loadCurrent = true): Promise<boolean> => {
  if (!ownsPlayback()) return false;
  if (shuffle === "on" && index >= queue.length - 1 && queue.length > 1) {
    shuffleKeepingCurrent();
    publish();
    await selectIndex(1, loadCurrent, true);
    return true;
  }
  const target = index + 1 >= queue.length ? 0 : index + 1;
  await selectIndex(target, loadCurrent, true);
  return true;
};

export const prev = async (loadCurrent = true): Promise<boolean> => {
  if (!ownsPlayback()) return false;
  const target = index - 1 < 0 ? queue.length - 1 : index - 1;
  await selectIndex(target, loadCurrent, true);
  return true;
};

export const updateQueueItem = (
  itemIndex: number,
  item: PlaybackQueueItem,
): PlaybackSessionSnapshot => {
  if (itemIndex < 0 || itemIndex >= queue.length) return snapshot();
  const previousId = queue[itemIndex].track.id;
  queue[itemIndex] = cloneQueue([item])[0];
  if (originalQueue) {
    originalQueue = originalQueue.map((entry) =>
      entry.track.id === previousId ? cloneQueue([item])[0] : entry,
    );
  }
  publish();
  return snapshot();
};

export const moveQueue = (fromIndex: number, toIndex: number): PlaybackSessionSnapshot => {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    fromIndex >= queue.length ||
    toIndex < 0 ||
    toIndex >= queue.length
  ) {
    return snapshot();
  }
  const [item] = queue.splice(fromIndex, 1);
  queue.splice(toIndex, 0, item);
  if (index === fromIndex) index = toIndex;
  else if (fromIndex < index && toIndex >= index) index--;
  else if (fromIndex > index && toIndex <= index) index++;
  publish();
  return snapshot();
};

export const removeServerTracks = (serverId: string): PlaybackSessionSnapshot => {
  const currentId = index >= 0 && index < queue.length ? queue[index].track.id : null;
  const keep = (item: PlaybackQueueItem): boolean =>
    !(item.track.source === "streaming" && item.track.serverId === serverId);
  const nextQueue = queue.filter(keep);
  if (nextQueue.length === queue.length) return snapshot();
  queue = nextQueue;
  if (originalQueue) originalQueue = originalQueue.filter(keep);
  if (queue.length === 0) {
    index = -1;
    active = false;
  } else if (currentId) {
    const nextIndex = queue.findIndex((item) => item.track.id === currentId);
    index = nextIndex >= 0 ? nextIndex : Math.min(Math.max(index, 0), queue.length - 1);
  } else {
    index = Math.min(Math.max(index, 0), queue.length - 1);
  }
  publish();
  return snapshot();
};

export const updateQueueTracks = (updates: Track[]): PlaybackSessionSnapshot => {
  if (updates.length === 0) return snapshot();
  const byId = new Map(updates.map((track) => [track.id, track]));
  const replace = (items: PlaybackQueueItem[]): PlaybackQueueItem[] =>
    items.map((item) => ({ ...item, track: byId.get(item.track.id) ?? item.track }));
  queue = replace(queue);
  if (originalQueue) originalQueue = replace(originalQueue);
  publish();
  return snapshot();
};

export const setRepeat = (mode: RepeatMode): PlaybackSessionSnapshot => {
  repeat = mode;
  publish();
  return snapshot();
};

export const setShuffle = (mode: ShuffleMode): PlaybackSessionSnapshot => {
  if (mode === shuffle) return snapshot();
  const currentId = index >= 0 && index < queue.length ? queue[index].track.id : null;
  if (mode === "on" && queue.length > 1) {
    originalQueue = cloneQueue(queue);
    shuffleKeepingCurrent();
  } else if (mode === "off" && originalQueue) {
    queue = cloneQueue(originalQueue);
    originalQueue = null;
    index = currentId
      ? Math.max(
          0,
          queue.findIndex((item) => item.track.id === currentId),
        )
      : 0;
  }
  shuffle = mode;
  publish();
  return snapshot();
};

/** Native ended 仅在无头模式由主进程消费；桌面模式继续交给 upstream renderer 结算。 */
export const onNativeEnded = (): boolean => {
  if (!isHeadlessMode() || !ownsPlayback()) return false;
  const advance = repeat === "one" ? selectIndex(index, true, true).then(() => true) : next();
  void advance.catch((error) => playerLog.error("[session] automatic next failed", error));
  return true;
};

/** 无头模式下音源失败由主进程推进权威队列。 */
export const onNativeSourceError = (): boolean => {
  if (!isHeadlessMode() || !ownsPlayback()) return false;
  void next().catch((error) => playerLog.error("[session] source-error next failed", error));
  return true;
};

export const getOutputDevices = (): AudioDevice[] => getPlayer().getOutputDevices();
export const scanDirettaDevices = (): Promise<AudioDevice[]> => getPlayer().scanDirettaDevices();

export const setOutputDevice = async (deviceId: string | null): Promise<void> => {
  assertHeadlessDirettaPrivilege(deviceId);
  await getPlayer().setOutputDevice(deviceId ?? undefined);
  store.set("player.outputDevice", deviceId);
  wsBroadcast({
    type: "deviceChanged",
    data: { defaultDevice: getPlayer().getDefaultDeviceName() ?? null },
  });
};

/** 当前 Native 实际选择的输出设备，而不是仅返回持久化偏好。 */
export const getSelectedOutputDevice = (): string | null =>
  getPlayer().getSelectedDeviceName() ?? null;
