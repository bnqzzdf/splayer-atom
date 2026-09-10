import type {
  AudioDevice,
  AudioQuality,
  MediaInfo,
  PlaybackQueueItem,
  PlaybackSessionMode,
  PlaybackSessionSnapshot,
  RepeatMode,
  ShuffleMode,
  Track,
  TrackDetail,
} from "@shared/types/player";
import { getPlayer } from "@main/services/engine";
import { fileURLToPath } from "node:url";
import { loadPlaybackSession, savePlaybackSession } from "@main/database/playbackSession";
import * as nowPlaying from "@main/services/nowPlaying";
import { loadPlayerSource } from "@main/services/playerLoad";
import {
  playbackSourceErrorCode,
  resolvePlaybackSource,
  type ResolvedPlaybackSource,
} from "@main/services/playbackSourceResolver";
import {
  isSkippablePlaybackError,
  nextPlaybackPreloadIndex,
  shouldRetryPlaybackSource,
} from "@main/services/playbackSourcePolicy";
import {
  consumeDirectPlaybackBoundary,
  consumePlaybackPreload,
  invalidatePlaybackPreload,
  schedulePlaybackPreload,
  waitForPlaybackPreloadIdle,
} from "@main/services/playbackPreloader";
import { commitDirectPlaybackBoundary } from "@main/services/directGapless";
import { discardDirectInput, materializeDirectInput } from "@main/atom/directInput";
import { parseSacdPlaybackSource, toNativeSacdPlaybackSource } from "@main/atom/sacdInput";
import {
  clearActiveCueRange,
  toDisplayDurationMs,
  toDisplayPositionMs,
  toEnginePositionMs,
} from "@main/services/playerTimeline";
import { store } from "@main/store";
import { publishCoreControlEvent } from "@main/services/coreControlEvents";
import { playerLog } from "@main/utils/logger";
import { toMs } from "@main/utils/time";
import { ErrorCode } from "@shared/types/errors";
import { shouldSkipDjTrack } from "@shared/utils/djMode";
import { isUpnpOutput, selectInitialHeadlessOutput } from "@shared/utils/outputDevice";
import type { PersonalFmOptions } from "@shared/types/personalFm";
import type { PlayerStatus } from "@shared/types/player";
import {
  getSelectedUpnpOutput,
  getUpnpOutputStatus,
  loadUpnpFile,
  pauseUpnpOutput,
  playUpnpOutput,
  prepareUpnpOutput,
  releaseUpnpOutput,
  scanUpnpDevices,
  seekUpnpOutput,
  selectUpnpOutput,
  setUpnpOutputObserver,
  stopUpnpOutput,
  type UpnpOutputObservation,
  type UpnpOutputStatus,
} from "@main/atom/upnp/output";
import {
  discardUpnpInput,
  extractUpnpCueDsf,
  extractUpnpCueWav,
  extractUpnpSacdDsf,
  inferUpnpMime,
  materializeUpnpInput,
  probeUpnpMediaQuality,
} from "@main/atom/upnp/media";
import * as neteaseScrobble from "@main/services/neteaseScrobble";
import * as listenbrainz from "@main/services/listenbrainz";
import { beginCorePlayStats, onCorePlayerState } from "@main/services/headlessPlayStats";
import {
  advancePersonalFmPool,
  alignPersonalFmPool,
  dislikePersonalFmCurrent,
  getPersonalFmOptions,
  resetPersonalFmPool,
  startPersonalFmPool,
} from "@main/services/personalFm";

let queue: PlaybackQueueItem[] = [];
let originalQueue: PlaybackQueueItem[] | null = null;
let index = -1;
let repeat: RepeatMode = "list";
let shuffle: ShuffleMode = "off";
let active = false;
let mode: PlaybackSessionMode = "queue";
let initialized = false;
let loadGeneration = 0;
let cueBoundaryGeneration = -1;
let sourceRecoveryAttempts = 0;
let autoClose = {
  enabled: false,
  duration: 30,
  endTime: 0,
  waitSongEnd: false,
  pendingStopOnEnd: false,
};
let autoCloseTimer: NodeJS.Timeout | null = null;
let upnpObservedGeneration = -1;
let upnpSeenPlaying = false;
let upnpEndedGeneration = -1;

const MAX_CONSECUTIVE_LOAD_FAILURES = 5;

const selectedOutputId = (): string | null => store.get("player.outputDevice") ?? null;

const isUpnpSelected = (): boolean => isUpnpOutput(selectedOutputId());

class CorePlaybackLoadError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CorePlaybackLoadError";
  }
}

const publishPlaybackError = (code: ErrorCode): void => {
  const event = { type: "error" as const, data: { error: code } };
  publishCoreControlEvent(event);
};

/** Linux Core Diretta Host requires root privileges in the supported deployment model. */
const assertCoreDirettaPrivilege = (deviceId: string | null | undefined): void => {
  if (
    process.platform === "linux" &&
    deviceId?.startsWith("diretta:") === true &&
    typeof process.getuid === "function" &&
    process.getuid() !== 0
  ) {
    throw new Error("Diretta Core on Linux requires root privileges");
  }
};

const cloneQueue = (items: PlaybackQueueItem[]): PlaybackQueueItem[] =>
  items.map((item) => ({ ...item, track: { ...item.track } }));

const snapshot = (): PlaybackSessionSnapshot => ({
  active,
  mode,
  personalFmOptions: mode === "personalFm" ? getPersonalFmOptions() : undefined,
  queue: cloneQueue(queue),
  originalQueue: originalQueue ? cloneQueue(originalQueue) : null,
  index,
  current: index >= 0 && index < queue.length ? { ...queue[index].track } : null,
  repeat,
  shuffle,
  autoClose: { ...autoClose },
});

const publish = (): void => {
  const data = snapshot();
  savePlaybackSession(data);
  publishCoreControlEvent({ type: "session", data });
};

const clearAutoCloseTimer = (): void => {
  if (autoCloseTimer !== null) clearTimeout(autoCloseTimer);
  autoCloseTimer = null;
};

const resetAutoClose = (): void => {
  clearAutoCloseTimer();
  autoClose = {
    enabled: false,
    duration: autoClose.duration,
    endTime: 0,
    waitSongEnd: false,
    pendingStopOnEnd: false,
  };
};

const onAutoCloseDeadline = (): void => {
  autoCloseTimer = null;
  if (!autoClose.enabled) return;
  if (autoClose.waitSongEnd) {
    autoClose.pendingStopOnEnd = true;
    invalidatePlaybackPreload();
    publish();
    return;
  }
  if (isUpnpSelected()) {
    void pauseUpnpOutput().catch((error) =>
      playerLog.warn(`[upnp] auto-close pause failed: ${String(error)}`),
    );
  } else {
    getPlayer().pause();
  }
  resetAutoClose();
  publish();
  scheduleNextPlaybackPreload();
};

const scheduleAutoCloseDeadline = (): void => {
  clearAutoCloseTimer();
  if (!autoClose.enabled) return;
  const delay = Math.max(0, autoClose.endTime - Date.now());
  autoCloseTimer = setTimeout(onAutoCloseDeadline, delay);
};

const logicalDsdQuality = (quality: AudioQuality | undefined): AudioQuality | undefined => {
  if (!quality || quality.bitsPerSample !== 1 || quality.sampleRate < 2_822_400) return undefined;
  return /(?:sacd|dsd|dsf|dff|dst)/i.test(quality.codec) ? quality : undefined;
};

/**
 * FFmpeg exposes DSD as packed 8-bit samples at DSD clock / 8 (DSD64 => 352.8 kHz / 8 bit).
 * Playback presentation must keep the scanner's logical 1-bit DSD clock instead of leaking that
 * decoder storage representation into Control.
 */
const projectLogicalDsdPlaybackMetadata = (
  track: Track,
  detail?: TrackDetail,
  mediaInfo?: MediaInfo,
): { detail?: TrackDetail; mediaInfo?: MediaInfo } => {
  const quality = logicalDsdQuality(track.quality);
  if (!quality) return { detail, mediaInfo };
  return {
    detail: detail ? { ...detail, quality } : detail,
    mediaInfo: mediaInfo ? { ...mediaInfo, quality } : mediaInfo,
  };
};

const publishTrackLoaded = (
  item: PlaybackQueueItem,
  source: string,
  autoPlay: boolean,
  detail?: TrackDetail,
  mediaInfo?: MediaInfo,
): void => {
  const projected = projectLogicalDsdPlaybackMetadata(item.track, detail, mediaInfo);
  const event = {
    type: "trackLoaded" as const,
    data: {
      track: { ...item.track },
      context: item.context,
      source,
      autoPlay,
      detail: projected.detail,
      mediaInfo: projected.mediaInfo,
    },
  };
  publishCoreControlEvent(event);
};

const publishUpnpObservedStatus = (remote: UpnpOutputStatus = getUpnpOutputStatus()): void => {
  const player = getPlayer();
  const playing = remote.state === "playing";
  onCorePlayerState(remote.state);
  nowPlaying.onPlayStateChange(remote.state);
  nowPlaying.onPosition(remote.position, playing);
  neteaseScrobble.onState(playing);
  neteaseScrobble.onPosition(remote.position);
  listenbrainz.onState(playing);
  publishCoreControlEvent({
    type: "status",
    data: {
      state: remote.state,
      position: remote.position,
      duration: remote.duration,
      volume: player.getVolume(),
      speed: player.getSpeed(),
      isFinished: remote.isFinished,
    },
  });
  publishCoreControlEvent({
    type: "position",
    data: { position: remote.position, duration: remote.duration },
  });
};

const isNearUpnpEnd = (remote: UpnpOutputStatus): boolean => {
  if (remote.duration <= 0) return false;
  const tolerance = Math.max(2000, Math.min(5000, Math.round(remote.duration * 0.02)));
  return remote.position >= Math.max(0, remote.duration - tolerance);
};

const handleUpnpNaturalEnd = (): void => {
  if (!ownsPlayback()) return;
  if (autoClose.pendingStopOnEnd) {
    resetAutoClose();
    publish();
    scheduleNextPlaybackPreload();
    return;
  }
  const advance =
    mode !== "personalFm" && repeat === "one"
      ? selectIndex(index, true, true).then(() => true)
      : next();
  void advance.catch((error) => playerLog.error("[session] UPnP automatic next failed", error));
};

const handleUpnpObservation = (observation: UpnpOutputObservation): void => {
  if (!isUpnpSelected() || getSelectedUpnpOutput() !== selectedOutputId()) return;
  if (observation.generation !== upnpObservedGeneration) {
    upnpObservedGeneration = observation.generation;
    upnpSeenPlaying = false;
  }
  const remote = observation.status;
  if (remote.state === "playing") upnpSeenPlaying = true;
  publishUpnpObservedStatus(remote);
  if (
    remote.state === "stopped" &&
    upnpSeenPlaying &&
    observation.generation !== upnpEndedGeneration &&
    isNearUpnpEnd(remote)
  ) {
    upnpEndedGeneration = observation.generation;
    handleUpnpNaturalEnd();
  }
};

const stopCurrentOutputBestEffort = (): void => {
  if (isUpnpSelected()) {
    void stopUpnpOutput().catch((error) => playerLog.warn(`[upnp] stop failed: ${String(error)}`));
    return;
  }
  getPlayer().stop();
};

const cueTrackNumber = (item: PlaybackQueueItem): number | null => {
  if (!item.track.cuePath) return null;
  const value = item.track.track;
  return Number.isInteger(value) && (value ?? 0) > 0 ? value! : null;
};

const isDsdCueTrack = (item: PlaybackQueueItem): boolean => {
  const codec = item.track.quality?.codec?.toLowerCase() ?? "";
  const source = item.track.cueAudioPath?.toLowerCase() ?? "";
  return codec === "dsd_dsf" || codec === "dsd_dff" || /\.(?:dsf|dff|dsdiff)$/.test(source);
};

const isIntegerLosslessCueTrack = (item: PlaybackQueueItem): boolean => {
  const codec = item.track.quality?.codec?.toLowerCase() ?? "";
  return /^(?:flac|ape|alac|wavpack|tta|shorten|pcm_[su])/.test(codec);
};

const assertUpnpResolvedTrackSupported = (
  item: PlaybackQueueItem,
  resolved: ResolvedPlaybackSource,
): void => {
  const track = item.track;
  if (track.quality?.channels && track.quality.channels !== 2) {
    throw new CorePlaybackLoadError(
      ErrorCode.UNKNOWN,
      "UPnP output currently supports stereo only",
    );
  }
  if (track.cuePath && cueTrackNumber(item) === null) {
    throw new CorePlaybackLoadError(ErrorCode.UNKNOWN, "UPnP CUE track number is unavailable");
  }
  if (track.cuePath && !isDsdCueTrack(item) && !isIntegerLosslessCueTrack(item)) {
    throw new CorePlaybackLoadError(
      ErrorCode.UNKNOWN,
      "UPnP CUE requires integer lossless PCM or native DSD source",
    );
  }
  const sourceLooksSacd = /\.iso(?:$|\|Track\d+\|)/i.test(resolved.source);
  if (sourceLooksSacd && parseSacdPlaybackSource(resolved.source, item.track.track) === null) {
    throw new CorePlaybackLoadError(ErrorCode.UNKNOWN, "UPnP SACD track identity is unavailable");
  }
};

const loadUpnpResolvedTrack = async (
  item: PlaybackQueueItem,
  resolved: ResolvedPlaybackSource,
  autoPlay: boolean,
  preserveListenBrainzSession: boolean,
  expectedGeneration: number,
): Promise<MediaInfo | null> => {
  const track = item.track;
  assertUpnpResolvedTrackSupported(item, resolved);
  let filePath: string;
  let temporaryInput: string | null = null;
  let representationDurationMs = track.duration;
  const cueNum = cueTrackNumber(item);
  const sacd = parseSacdPlaybackSource(resolved.source, item.track.track);

  if (track.cuePath && cueNum != null) {
    const generated = isDsdCueTrack(item)
      ? await extractUpnpCueDsf(track.cuePath, cueNum)
      : await extractUpnpCueWav(track.cuePath, cueNum);
    temporaryInput = generated.filePath;
    filePath = generated.filePath;
    representationDurationMs = generated.durationMs;
  } else if (sacd) {
    const generated = await extractUpnpSacdDsf(sacd.isoPath, sacd.trackNum);
    temporaryInput = generated.filePath;
    filePath = generated.filePath;
    representationDurationMs = generated.durationMs;
  } else if (/^https?:\/\//i.test(resolved.source)) {
    temporaryInput = await materializeUpnpInput(resolved.source);
    if (expectedGeneration !== loadGeneration) {
      await discardUpnpInput(temporaryInput);
      return null;
    }
    filePath = temporaryInput;
    if (resolved.cacheAfterLoad) {
      void resolved
        .cacheAfterLoad(temporaryInput)
        .catch((error) => playerLog.warn(`[upnp] source cache failed: ${String(error)}`));
    }
  } else {
    filePath = resolved.source.startsWith("file:")
      ? fileURLToPath(resolved.source)
      : resolved.source;
  }
  if (expectedGeneration !== loadGeneration) {
    if (temporaryInput) await discardUpnpInput(temporaryInput);
    return null;
  }
  const representationQuality = (await probeUpnpMediaQuality(filePath)) ?? track.quality;
  if (expectedGeneration !== loadGeneration) {
    if (temporaryInput) await discardUpnpInput(temporaryInput);
    return null;
  }
  try {
    await loadUpnpFile({
      filePath,
      title: track.title || filePath.split(/[/\\]/).pop() || filePath,
      durationMs: representationDurationMs,
      mime: inferUpnpMime(filePath, representationQuality?.codec ?? track.quality?.codec),
      autoPlay: false,
      deleteOnRelease: temporaryInput != null,
    });
  } catch (error) {
    if (temporaryInput) await discardUpnpInput(temporaryInput);
    throw error;
  }
  const observed = getUpnpOutputStatus();
  const duration = Math.max(representationDurationMs || 0, observed.duration || 0);
  neteaseScrobble.onTrackLoaded(track, item.context, duration, false);
  if (!preserveListenBrainzSession) listenbrainz.onTrackLoaded(track, duration, false);
  beginCorePlayStats({ ...track, duration, quality: representationQuality }, false);
  return {
    title: track.title,
    artists: track.artists,
    album: track.album,
    duration,
    cover: track.cover,
    quality: representationQuality,
  };
};

const scheduleNextPlaybackPreload = (): void => {
  if (!active || (autoClose.enabled && autoClose.waitSongEnd)) {
    invalidatePlaybackPreload();
    return;
  }
  const effectiveRepeat = mode === "personalFm" ? "list" : repeat;
  const targetIndex = nextPlaybackPreloadIndex(
    index,
    queue.length,
    effectiveRepeat,
    shuffle,
    (candidate) =>
      store.get("player.fuckDjMode") === true ? shouldSkipDjTrack(queue[candidate].track) : false,
  );
  if (targetIndex === null) {
    invalidatePlaybackPreload();
    return;
  }
  schedulePlaybackPreload(targetIndex, queue[targetIndex]);
};

interface LoadIndexRuntimeOptions {
  sourceRecovery?: boolean;
  resolvedOverride?: ResolvedPlaybackSource;
  preserveListenBrainzSession?: boolean;
}

const loadIndex = async (
  targetIndex: number,
  autoPlay = true,
  runtime: LoadIndexRuntimeOptions = {},
): Promise<void> => {
  const sourceRecovery = runtime.sourceRecovery === true;
  if (targetIndex < 0 || targetIndex >= queue.length) throw new Error("queue index out of range");
  // Direct staging/cancel 与 full load 共享同一个 native runtime；先收敛旧控制命令，避免跨格式重连竞态。
  await waitForPlaybackPreloadIdle();
  if (!selectedOutputId()) {
    throw new CorePlaybackLoadError(
      ErrorCode.OUTPUT_DEVICE_REQUIRED,
      "Core output device must be selected before playback",
    );
  }
  if (!sourceRecovery) sourceRecoveryAttempts = 0;
  const generation = ++loadGeneration;
  const item = queue[targetIndex];
  const track = item.track;
  let resolved = runtime.resolvedOverride ?? consumePlaybackPreload(targetIndex, item);
  if (!resolved) {
    try {
      resolved = await resolvePlaybackSource(track);
    } catch (error) {
      throw new CorePlaybackLoadError(
        playbackSourceErrorCode(error),
        `${track.source} source resolve failed`,
        { cause: error },
      );
    }
  }
  if (generation !== loadGeneration) return;

  playerLog.info(`[session] load ${track.source} track: ${track.title}`);
  if (isUpnpSelected()) {
    const mediaInfo = await loadUpnpResolvedTrack(
      item,
      resolved,
      autoPlay,
      runtime.preserveListenBrainzSession === true,
      generation,
    );
    if (!mediaInfo || generation !== loadGeneration) return;
    if (mode === "personalFm") {
      queue = alignPersonalFmPool(targetIndex).map((fmTrack) => ({ track: fmTrack }));
      originalQueue = null;
      index = queue.length > 0 ? 0 : -1;
    } else {
      index = targetIndex;
    }
    active = index >= 0;
    if (mediaInfo.quality) item.track = { ...item.track, quality: mediaInfo.quality };
    const duration = Math.max(item.track.duration || 0, mediaInfo.duration);
    nowPlaying.update({ ...item.track, duration }, [], null);
    publish();
    publishTrackLoaded(
      item,
      resolved.source,
      autoPlay,
      mediaInfo.quality ? { quality: mediaInfo.quality, externalLyrics: [] } : undefined,
      mediaInfo,
    );
    if (autoPlay) await playUpnpOutput();
    else publishUpnpObservedStatus();
    scheduleNextPlaybackPreload();
    return;
  }

  const nativeSource =
    toNativeSacdPlaybackSource(resolved.source, track.track, track.duration) ?? resolved.source;

  let cacheStartedFromDirectInput = false;
  const cacheResolvedSource = (materializedSource?: string): void => {
    if (!resolved.cacheAfterLoad) return;
    if (materializedSource) cacheStartedFromDirectInput = true;
    void resolved
      .cacheAfterLoad(materializedSource)
      .catch((error) => playerLog.warn(`[session] source cache failed: ${String(error)}`));
  };
  const result = await loadPlayerSource(
    nativeSource,
    {
      autoPlay,
      meta: track,
      context: item.context,
    },
    {
      preserveListenBrainzSession: runtime.preserveListenBrainzSession,
      onDirectMaterialized: cacheResolvedSource,
    },
  );
  if (generation !== loadGeneration) return;
  if (!result.success || !result.data) {
    const code = Object.values(ErrorCode).includes(result.error as ErrorCode)
      ? (result.error as ErrorCode)
      : ErrorCode.UNKNOWN;
    throw new CorePlaybackLoadError(code, `${track.source} session load failed: ${code}`);
  }

  if (resolved.cacheAfterLoad && !cacheStartedFromDirectInput) cacheResolvedSource();
  if (track.source === "local") {
    const mediaInfo = result.data.mediaInfo;
    const fileName = track.path?.split(/[/\\]/).pop() ?? "";
    const derivedTitle = fileName.replace(/\.[^.]+$/, "");
    item.track = {
      ...track,
      title:
        !track.title || track.title === derivedTitle ? mediaInfo.title || track.title : track.title,
      artists: track.artists.length > 0 ? track.artists : (mediaInfo.artists ?? []),
      album: track.album ?? mediaInfo.album,
      duration: track.duration || mediaInfo.duration,
      cover: track.cover ?? mediaInfo.cover,
      quality: track.quality ?? mediaInfo.quality,
    };
  }

  if (mode === "personalFm") {
    queue = alignPersonalFmPool(targetIndex).map((fmTrack) => ({ track: fmTrack }));
    originalQueue = null;
    index = queue.length > 0 ? 0 : -1;
  } else {
    index = targetIndex;
  }
  active = index >= 0;
  const loadedTrack = item.track;
  const duration = Math.max(loadedTrack.duration || 0, result.data.mediaInfo.duration);
  // 成功加载后的 session publish 必须晚于 NowPlaying 提交：Control 即使漏掉一次
  // trackLoaded，也能用 session.current 与 /now-playing 做一致性恢复。
  nowPlaying.update({ ...loadedTrack, duration }, [], null);
  nowPlaying.onPosition(0, autoPlay);
  nowPlaying.onPlayStateChange(autoPlay ? "playing" : "paused");
  publish();
  publishTrackLoaded(item, resolved.source, autoPlay, result.data.detail, result.data.mediaInfo);
  scheduleNextPlaybackPreload();
};

const loadIndexWithPolicy = async (targetIndex: number, autoPlay = true): Promise<boolean> => {
  if (targetIndex < 0 || targetIndex >= queue.length) return false;
  const maxAttempts = Math.max(1, Math.min(MAX_CONSECUTIVE_LOAD_FAILURES, queue.length));
  let candidateIndex = targetIndex;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (store.get("player.fuckDjMode") === true && shouldSkipDjTrack(queue[candidateIndex].track)) {
      playerLog.info(`[session] Fuck DJ Mode skipped: ${queue[candidateIndex].track.title}`);
      if (attempt + 1 >= maxAttempts) break;
      invalidatePlaybackPreload();
      candidateIndex = candidateIndex + 1 >= queue.length ? 0 : candidateIndex + 1;
      continue;
    }
    try {
      await loadIndex(candidateIndex, autoPlay);
      return true;
    } catch (error) {
      const code = error instanceof CorePlaybackLoadError ? error.code : ErrorCode.UNKNOWN;
      publishPlaybackError(code);
      playerLog.warn(
        `[session] load failed index=${candidateIndex} code=${code} attempt=${attempt + 1}/${maxAttempts}`,
      );
      if (!isSkippablePlaybackError(code)) throw error;
      if (attempt + 1 >= maxAttempts) break;
      invalidatePlaybackPreload();
      candidateIndex = candidateIndex + 1 >= queue.length ? 0 : candidateIndex + 1;
    }
  }

  ++loadGeneration;
  invalidatePlaybackPreload();
  stopCurrentOutputBestEffort();
  active = false;
  nowPlaying.onPlayStateChange("stopped");
  publish();
  return false;
};

export const initPlaybackSession = async (): Promise<void> => {
  if (initialized) return;
  initialized = true;
  setUpnpOutputObserver(handleUpnpObservation);
  const persisted = loadPlaybackSession();
  if (persisted) {
    queue = cloneQueue(persisted.queue);
    originalQueue = persisted.originalQueue ? cloneQueue(persisted.originalQueue) : null;
    index = persisted.index;
    repeat = persisted.repeat;
    shuffle = persisted.shuffle;
    mode = "queue";
    active = queue.length > 0;
  }
  const player = getPlayer();
  // Core 启动时恢复持久化样本域设置。
  player.setVolume(store.get("player.volume"));
  player.setNormalizationEnabled(store.get("player.loudnessNormalization"));
  player.setEqualizerEnabled(store.get("player.equalizer.enabled"));
  player.setEqualizerBands(store.get("player.equalizer.bands"));
  player.setPreampGain(store.get("player.equalizer.preamp"));
  player.setFadeDuration(store.get("player.fadeEnabled") ? store.get("player.fadeDuration") : 0);
  const output = store.get("player.outputDevice");
  if (output) {
    try {
      if (isUpnpOutput(output)) {
        selectUpnpOutput(output);
      } else {
        assertCoreDirettaPrivilege(output);
        await player.setOutputDevice(output);
      }
    } catch (error) {
      playerLog.warn(`[session] persisted output not activated: ${String(error)}`);
    }
  } else {
    const initialOutput = selectInitialHeadlessOutput(player.getOutputDevices());
    if (initialOutput) {
      try {
        await player.setOutputDevice(initialOutput);
        store.set("player.outputDevice", initialOutput);
        playerLog.info(`[session] selected sole ALSA hardware output: ${initialOutput}`);
      } catch (error) {
        playerLog.warn(`[session] initial ALSA output not activated: ${String(error)}`);
      }
    }
  }
};

/** 释放 Atom-owned 远端输出运行态；本地 audio-engine 继续使用既有 lifecycle。 */
export const shutdownPlaybackSession = async (): Promise<void> => {
  ++loadGeneration;
  invalidatePlaybackPreload();
  clearAutoCloseTimer();
  setUpnpOutputObserver(null);
  if (!getSelectedUpnpOutput()) return;
  try {
    await stopUpnpOutput();
  } catch (error) {
    playerLog.warn(`[upnp] shutdown stop failed: ${String(error)}`);
  }
  await releaseUpnpOutput();
};

export const getPlaybackSession = (): PlaybackSessionSnapshot => snapshot();

/** Core playback policy 改变后重算下一首预载；若不再满足条件会取消已有 Direct staging。 */
export const refreshPlaybackPreload = (): void => scheduleNextPlaybackPreload();

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
  mode = "queue";
  active = queue.length > 0;
  publish();
  return snapshot();
};

export const ownsPlayback = (): boolean => active && queue.length > 0;

const leavePersonalFmMode = (): void => {
  if (mode !== "personalFm") return;
  mode = "queue";
  resetPersonalFmPool();
};

const applyPersonalFmPool = (tracks: Track[]): boolean => {
  queue = tracks.map((track) => ({ track: { ...track } }));
  originalQueue = null;
  index = queue.length > 0 ? 0 : -1;
  active = index >= 0;
  mode = active ? "personalFm" : "queue";
  return active;
};

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
  invalidatePlaybackPreload();
  leavePersonalFmMode();
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
  if (loadCurrent) await loadIndexWithPolicy(index, autoPlay);
  return snapshot();
};

export const playTrack = async (track: Track, autoPlay = true): Promise<PlaybackSessionSnapshot> =>
  replaceQueue([{ track }], 0, autoPlay);

export const appendQueue = (items: PlaybackQueueItem[]): PlaybackSessionSnapshot => {
  leavePersonalFmMode();
  queue.push(...cloneQueue(items));
  if (originalQueue) originalQueue.push(...cloneQueue(items));
  if (queue.length > 0) active = true;
  publish();
  scheduleNextPlaybackPreload();
  return snapshot();
};

export const insertQueue = (
  items: PlaybackQueueItem[],
  insertIndex: number,
): PlaybackSessionSnapshot => {
  if (items.length === 0) return snapshot();
  leavePersonalFmMode();
  const safeIndex = Math.max(0, Math.min(insertIndex, queue.length));
  const entries = cloneQueue(items);
  queue.splice(safeIndex, 0, ...entries);
  if (safeIndex <= index) index += entries.length;
  if (originalQueue) originalQueue.push(...cloneQueue(items));
  active = queue.length > 0;
  publish();
  scheduleNextPlaybackPreload();
  return snapshot();
};

export const removeQueueIndex = async (
  removeIndex: number,
  loadCurrent = true,
): Promise<PlaybackSessionSnapshot> => {
  if (removeIndex < 0 || removeIndex >= queue.length) return snapshot();
  invalidatePlaybackPreload();
  leavePersonalFmMode();
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
    if (loadCurrent) await loadIndexWithPolicy(index, true);
  } else {
    publish();
    scheduleNextPlaybackPreload();
  }
  return snapshot();
};

export const clearQueue = async (stop = false): Promise<void> => {
  ++loadGeneration;
  leavePersonalFmMode();
  sourceRecoveryAttempts = 0;
  invalidatePlaybackPreload();
  queue = [];
  originalQueue = null;
  index = -1;
  active = false;
  nowPlaying.clear();
  clearActiveCueRange();
  if (stop) stopCurrentOutputBestEffort();
  publish();
};

export const play = async (): Promise<void> => {
  const state = isUpnpSelected() ? getUpnpOutputStatus().state : getPlayer().getStatus().state;
  if (queue.length > 0 && (index < 0 || state === "stopped")) {
    await loadIndexWithPolicy(Math.max(0, index), true);
    return;
  }
  if (isUpnpSelected()) {
    await playUpnpOutput();
    return;
  }
  await getPlayer().play();
};

export const pause = (): void => {
  if (isUpnpSelected()) {
    void pauseUpnpOutput().catch((error) =>
      playerLog.warn(`[upnp] pause failed: ${String(error)}`),
    );
    return;
  }
  getPlayer().pause();
};
export const stop = (): void => {
  ++loadGeneration;
  invalidatePlaybackPreload();
  clearActiveCueRange();
  stopCurrentOutputBestEffort();
};
export const seek = (positionMs: number): Promise<void> =>
  isUpnpSelected()
    ? seekUpnpOutput(Math.max(0, positionMs))
    : getPlayer().seek(toEnginePositionMs(Math.max(0, positionMs)) / 1000);

/**
 * 重新解析并热替换当前 canonical Track。
 * 用于音质/凭据策略变化等必须 fresh source 的场景；不进入普通 skip loop，避免把旧进度套到下一首。
 */
export const reloadCurrent = async (forcePlay?: boolean): Promise<boolean> => {
  if (!ownsPlayback() || index < 0 || index >= queue.length) return false;
  const currentStatus = getPlaybackStatus();
  const state = currentStatus.state;
  const shouldPlay = forcePlay ?? state === "playing";
  const resumePositionMs = currentStatus.position;
  invalidatePlaybackPreload();
  try {
    await loadIndex(index, false, { preserveListenBrainzSession: true });
    if (resumePositionMs > 0) await seek(resumePositionMs);
    if (shouldPlay) await play();
    return true;
  } catch (error) {
    const code = error instanceof CorePlaybackLoadError ? error.code : ErrorCode.UNKNOWN;
    publishPlaybackError(code);
    playerLog.warn(`[session] reload current failed code=${code}: ${String(error)}`);
    return false;
  }
};

export const startPersonalFm = async (
  options?: PersonalFmOptions,
  autoPlay = true,
): Promise<PlaybackSessionSnapshot> => {
  invalidatePlaybackPreload();
  const tracks = await startPersonalFmPool(options);
  if (!applyPersonalFmPool(tracks)) {
    publishPlaybackError(ErrorCode.NETEASE_UNAVAILABLE);
    publish();
    return snapshot();
  }
  publish();
  await loadIndexWithPolicy(0, autoPlay);
  return snapshot();
};

const advancePersonalFm = async (loadCurrent = true): Promise<boolean> => {
  invalidatePlaybackPreload();
  const tracks = await advancePersonalFmPool();
  if (!applyPersonalFmPool(tracks)) {
    stopCurrentOutputBestEffort();
    nowPlaying.onPlayStateChange("stopped");
    publish();
    return false;
  }
  publish();
  if (loadCurrent) await loadIndexWithPolicy(0, true);
  else scheduleNextPlaybackPreload();
  return true;
};

export const dislikePersonalFm = async (playedSec?: number): Promise<PlaybackSessionSnapshot> => {
  if (mode !== "personalFm") return snapshot();
  invalidatePlaybackPreload();
  const tracks = await dislikePersonalFmCurrent(playedSec);
  if (!applyPersonalFmPool(tracks)) {
    stopCurrentOutputBestEffort();
    nowPlaying.onPlayStateChange("stopped");
    publish();
    return snapshot();
  }
  publish();
  await loadIndexWithPolicy(0, true);
  return snapshot();
};

export const selectIndex = async (
  targetIndex: number,
  loadCurrent = true,
  autoPlay = true,
): Promise<PlaybackSessionSnapshot> => {
  if (targetIndex < 0 || targetIndex >= queue.length) return snapshot();
  invalidatePlaybackPreload();
  index = targetIndex;
  active = true;
  publish();
  if (loadCurrent) await loadIndexWithPolicy(index, autoPlay);
  return snapshot();
};

export const next = async (loadCurrent = true): Promise<boolean> => {
  if (!ownsPlayback()) return false;
  if (mode === "personalFm") return advancePersonalFm(loadCurrent);
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
  if (!ownsPlayback() || mode === "personalFm") return false;
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
  scheduleNextPlaybackPreload();
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
  leavePersonalFmMode();
  const [item] = queue.splice(fromIndex, 1);
  queue.splice(toIndex, 0, item);
  if (index === fromIndex) index = toIndex;
  else if (fromIndex < index && toIndex >= index) index--;
  else if (fromIndex > index && toIndex <= index) index++;
  publish();
  scheduleNextPlaybackPreload();
  return snapshot();
};

export const removeServerTracks = (serverId: string): PlaybackSessionSnapshot => {
  invalidatePlaybackPreload();
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
  if (currentId && queue[index]?.track.id === currentId) scheduleNextPlaybackPreload();
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
  scheduleNextPlaybackPreload();
  return snapshot();
};

export const setRepeat = (mode: RepeatMode): PlaybackSessionSnapshot => {
  repeat = mode;
  publish();
  scheduleNextPlaybackPreload();
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
  scheduleNextPlaybackPreload();
  return snapshot();
};

/** 启动或更新 Core 定时关闭；deadline 到点后即使没有 Control 仍会执行。 */
export const setAutoClose = (
  durationMin: number,
  waitSongEnd: boolean,
): PlaybackSessionSnapshot => {
  const duration = Math.max(1, Math.round(Number.isFinite(durationMin) ? durationMin : 1));
  autoClose = {
    enabled: true,
    duration,
    endTime: Date.now() + duration * 60_000,
    waitSongEnd,
    pendingStopOnEnd: false,
  };
  invalidatePlaybackPreload();
  scheduleAutoCloseDeadline();
  publish();
  scheduleNextPlaybackPreload();
  return snapshot();
};

/** 取消 Core 定时关闭并恢复正常 next-track preload。 */
export const cancelAutoClose = (): PlaybackSessionSnapshot => {
  resetAutoClose();
  publish();
  scheduleNextPlaybackPreload();
  return snapshot();
};

/** Direct staged boundary 发生后由 Core 提交 queue/index/now-playing，不再经过 Control load。 */
export const onNativeDirectTrackBoundary = (
  generation: number,
  eventDurationMs: number,
): boolean => {
  if (!ownsPlayback()) return false;

  const recoverAuthoritativeQueue = async (): Promise<void> => {
    getPlayer().stop();
    if (!ownsPlayback()) return;
    if (mode !== "personalFm" && repeat === "one") {
      await selectIndex(index, true, true);
      return;
    }
    await next();
  };

  const prepared = consumeDirectPlaybackBoundary(generation, queue);
  if (!prepared) {
    playerLog.warn(
      `[session] stale Direct boundary generation=${generation}, restoring queue authority`,
    );
    void recoverAuthoritativeQueue().catch((error) =>
      playerLog.error("[session] Direct boundary recovery failed", error),
    );
    return true;
  }

  try {
    const track = prepared.item.track;
    const duration = Math.max(track.duration || 0, eventDurationMs || 0);
    commitDirectPlaybackBoundary(prepared.directSource, duration, track, prepared.item.context);
    if (mode === "personalFm") {
      queue = alignPersonalFmPool(prepared.queueIndex).map((fmTrack) => ({ track: fmTrack }));
      originalQueue = null;
      index = queue.length > 0 ? 0 : -1;
    } else {
      index = prepared.queueIndex;
    }
    active = index >= 0;
    sourceRecoveryAttempts = 0;
    nowPlaying.update({ ...track, duration }, [], null);
    nowPlaying.onPosition(0, true);
    nowPlaying.onPlayStateChange("playing");
    publish();
    publishTrackLoaded(prepared.item, prepared.directSource, true, prepared.directDetail, {
      duration,
      quality: prepared.directDetail?.quality,
    });
    scheduleNextPlaybackPreload();
  } catch (error) {
    playerLog.error(`[session] Direct boundary commit failed: ${String(error)}`);
    void recoverAuthoritativeQueue().catch((recoveryError) =>
      playerLog.error("[session] Direct boundary recovery failed", recoveryError),
    );
  }
  return true;
};

const consumeAutoCloseOnEnded = (): boolean => {
  if (!autoClose.pendingStopOnEnd) return false;
  getPlayer().pause();
  resetAutoClose();
  publish();
  scheduleNextPlaybackPreload();
  return true;
};

const advanceAfterNaturalEnd = (): void => {
  if (consumeAutoCloseOnEnded()) return;
  const advance =
    mode !== "personalFm" && repeat === "one"
      ? selectIndex(index, true, true).then(() => true)
      : next();
  void advance.catch((error) => playerLog.error("[session] automatic next failed", error));
};

/** CUE 使用母版文件播放时，由 Core 在虚拟分轨结束位置收口并推进权威队列。 */
export const onNativePosition = (enginePositionMs: number): boolean => {
  if (!ownsPlayback() || isUpnpSelected()) return false;
  const track = queue[index]?.track;
  const cueEndMs = track?.cueEndMs;
  if (
    cueEndMs == null ||
    !Number.isFinite(cueEndMs) ||
    getPlayer().getStatus().state !== "playing" ||
    enginePositionMs < cueEndMs
  ) {
    return false;
  }
  if (cueBoundaryGeneration === loadGeneration) return true;

  cueBoundaryGeneration = loadGeneration;
  getPlayer().pauseImmediately();
  advanceAfterNaturalEnd();
  return true;
};

/** Native ended 由唯一 Core session 消费；Control 不再拥有 auto-next。 */
export const onNativeEnded = (): boolean => {
  if (!ownsPlayback()) return false;
  advanceAfterNaturalEnd();
  return true;
};

/** sourceError 最多 fresh resolve 当前 canonical Track 一次；再次失败后跳过当前项。 */
export const onNativeSourceError = (): boolean => {
  if (!ownsPlayback()) return false;
  const track = queue[index]?.track;
  if (!track) return false;

  const advance = async (): Promise<void> => {
    if (mode === "personalFm") {
      await next();
      return;
    }
    if (queue.length <= 1) {
      ++loadGeneration;
      getPlayer().stop();
      active = false;
      publish();
      return;
    }
    await next();
  };

  if (shouldRetryPlaybackSource(track, sourceRecoveryAttempts)) {
    sourceRecoveryAttempts++;
    playerLog.warn(`[session] source error, fresh resolve once: ${track.title}`);
    void loadIndex(index, true, {
      sourceRecovery: true,
      preserveListenBrainzSession: true,
    }).catch(async (error) => {
      playerLog.warn(`[session] source recovery failed, advancing: ${String(error)}`);
      try {
        await advance();
      } catch (advanceError) {
        playerLog.error("[session] source-error advance failed", advanceError);
      }
    });
    return true;
  }

  void advance().catch((error) => playerLog.error("[session] source-error advance failed", error));
  return true;
};

export const getOutputDevices = (): AudioDevice[] => getPlayer().getOutputDevices();
export const scanDirettaDevices = (): Promise<AudioDevice[]> => getPlayer().scanDirettaDevices();
export const scanUpnpOutputDevices = (): Promise<AudioDevice[]> =>
  scanUpnpDevices().catch((error) => {
    playerLog.debug(`[upnp] discovery skipped: ${String(error)}`);
    return [];
  });

export const setOutputDevice = async (deviceId: string | null): Promise<void> => {
  assertCoreDirettaPrivilege(deviceId);
  invalidatePlaybackPreload();
  const player = getPlayer();
  const previousPreference = store.get("player.outputDevice");

  if (isUpnpOutput(deviceId)) {
    await prepareUpnpOutput(deviceId!);
    if (deviceId === previousPreference) {
      selectUpnpOutput(deviceId!);
      scheduleNextPlaybackPreload();
      return;
    }
    const previousWasUpnp = isUpnpOutput(previousPreference);
    const state = previousWasUpnp
      ? getUpnpOutputStatus().state
      : (player.getStatus().state as PlayerStatus["state"]);
    const shouldReloadCurrent =
      ownsPlayback() &&
      index >= 0 &&
      index < queue.length &&
      (state === "playing" || state === "paused");
    const resumePositionMs = shouldReloadCurrent
      ? previousWasUpnp
        ? getUpnpOutputStatus().position
        : toDisplayPositionMs(toMs(player.getPosition()))
      : 0;
    const shouldResumePlaying =
      state === "playing" && store.get("player.pauseOnDeviceSwitch") !== true;
    const playbackGeneration = loadGeneration;
    const currentTrackId = shouldReloadCurrent ? (queue[index]?.track.id ?? null) : null;
    let previousResolved: ResolvedPlaybackSource | null = null;

    if (shouldReloadCurrent) {
      previousResolved = await resolvePlaybackSource(queue[index].track);
      assertUpnpResolvedTrackSupported(queue[index], previousResolved);
      if (loadGeneration !== playbackGeneration || queue[index]?.track.id !== currentTrackId) {
        throw new Error("playback changed while preparing UPnP output switch");
      }
    }

    try {
      if (previousWasUpnp) await stopUpnpOutput();
      else if (shouldReloadCurrent) player.stop();

      selectUpnpOutput(deviceId!);
      store.set("player.outputDevice", deviceId);
      publishCoreControlEvent({
        type: "deviceChanged",
        data: { defaultDevice: player.getDefaultDeviceName() ?? null },
      });

      if (shouldReloadCurrent && previousResolved) {
        await loadIndex(index, false, {
          resolvedOverride: previousResolved,
          preserveListenBrainzSession: true,
        });
        if (resumePositionMs > 0) await seek(resumePositionMs);
        if (shouldResumePlaying) await play();
      }
    } catch (switchError) {
      try {
        if (previousWasUpnp && previousPreference) {
          selectUpnpOutput(previousPreference);
          store.set("player.outputDevice", previousPreference);
        } else {
          store.set("player.outputDevice", previousPreference ?? null);
          await releaseUpnpOutput();
          await player.setOutputDevice(previousPreference ?? undefined);
        }
        if (shouldReloadCurrent && previousResolved) {
          await loadIndex(index, false, {
            resolvedOverride: previousResolved,
            preserveListenBrainzSession: true,
          });
          if (resumePositionMs > 0) await seek(resumePositionMs);
          if (state === "playing") await play();
        }
      } catch (rollbackError) {
        playerLog.error(`[session] UPnP output rollback failed: ${String(rollbackError)}`);
      }
      throw switchError;
    } finally {
      scheduleNextPlaybackPreload();
    }
    return;
  }

  if (isUpnpOutput(previousPreference)) {
    const remote = getUpnpOutputStatus();
    const state = remote.state;
    const shouldReloadCurrent =
      ownsPlayback() &&
      index >= 0 &&
      index < queue.length &&
      (state === "playing" || state === "paused");
    const resumePositionMs = shouldReloadCurrent ? remote.position : 0;
    const shouldResumePlaying =
      state === "playing" && store.get("player.pauseOnDeviceSwitch") !== true;
    const playbackGeneration = loadGeneration;
    const currentTrackId = shouldReloadCurrent ? (queue[index]?.track.id ?? null) : null;
    let previousResolved: ResolvedPlaybackSource | null = null;
    let targetResolved: ResolvedPlaybackSource | null = null;
    let managedDirectInput: string | null = null;

    if (shouldReloadCurrent) {
      previousResolved = await resolvePlaybackSource(queue[index].track);
      targetResolved = previousResolved;
      if (
        deviceId?.startsWith("diretta:") === true &&
        /^https?:\/\//i.test(previousResolved.source)
      ) {
        const cached = previousResolved.cacheAfterLoad
          ? await previousResolved.cacheAfterLoad()
          : null;
        const source = cached ?? (await materializeDirectInput(previousResolved.source));
        if (!cached) managedDirectInput = source;
        targetResolved = {
          ...previousResolved,
          source,
          provider: cached ? "cache" : previousResolved.provider,
          cacheAfterLoad: undefined,
        };
      }
      if (loadGeneration !== playbackGeneration || queue[index]?.track.id !== currentTrackId) {
        if (managedDirectInput) void discardDirectInput(managedDirectInput);
        throw new Error("playback changed while preparing native output switch");
      }
    }

    try {
      await stopUpnpOutput();
      await player.setOutputDevice(deviceId ?? undefined);
      store.set("player.outputDevice", deviceId);
      await releaseUpnpOutput();
      publishCoreControlEvent({
        type: "deviceChanged",
        data: { defaultDevice: player.getDefaultDeviceName() ?? null },
      });
      if (shouldReloadCurrent && targetResolved) {
        await loadIndex(index, false, {
          resolvedOverride: targetResolved,
          preserveListenBrainzSession: true,
        });
        if (resumePositionMs > 0) await seek(resumePositionMs);
        if (shouldResumePlaying) await play();
      }
    } catch (switchError) {
      if (managedDirectInput) void discardDirectInput(managedDirectInput);
      try {
        selectUpnpOutput(previousPreference!);
        store.set("player.outputDevice", previousPreference);
        if (shouldReloadCurrent && previousResolved) {
          await loadIndex(index, false, {
            resolvedOverride: previousResolved,
            preserveListenBrainzSession: true,
          });
          if (resumePositionMs > 0) await seek(resumePositionMs);
          if (state === "playing") await play();
        }
      } catch (rollbackError) {
        playerLog.error(`[session] UPnP output rollback failed: ${String(rollbackError)}`);
      }
      throw switchError;
    } finally {
      scheduleNextPlaybackPreload();
    }
    return;
  }

  const state = player.getStatus().state;
  const shouldReloadCurrent =
    ownsPlayback() &&
    index >= 0 &&
    index < queue.length &&
    (state === "playing" || state === "paused");
  const resumePositionMs = shouldReloadCurrent
    ? toDisplayPositionMs(toMs(player.getPosition()))
    : 0;
  const playbackGeneration = loadGeneration;
  const currentTrackId = shouldReloadCurrent ? (queue[index]?.track.id ?? null) : null;
  const shouldResumePlaying =
    state === "playing" && store.get("player.pauseOnDeviceSwitch") !== true;

  let previousResolved: ResolvedPlaybackSource | null = null;
  let targetResolved: ResolvedPlaybackSource | null = null;
  let managedDirectInput: string | null = null;

  try {
    if (shouldReloadCurrent) {
      const item = queue[index];
      previousResolved = await resolvePlaybackSource(item.track);
      targetResolved = previousResolved;
      if (
        deviceId?.startsWith("diretta:") === true &&
        /^https?:\/\//i.test(previousResolved.source)
      ) {
        const cached = previousResolved.cacheAfterLoad
          ? await previousResolved.cacheAfterLoad()
          : null;
        const source = cached ?? (await materializeDirectInput(previousResolved.source));
        if (!cached) managedDirectInput = source;
        targetResolved = {
          ...previousResolved,
          source,
          provider: cached ? "cache" : previousResolved.provider,
          cacheAfterLoad: undefined,
        };
      }
      if (loadGeneration !== playbackGeneration || queue[index]?.track.id !== currentTrackId) {
        if (managedDirectInput) void discardDirectInput(managedDirectInput);
        throw new Error("playback changed while preparing output switch");
      }
      player.stop();
    }

    try {
      await player.setOutputDevice(deviceId ?? undefined);
    } catch (switchError) {
      if (managedDirectInput) void discardDirectInput(managedDirectInput);
      try {
        await player.setOutputDevice(previousPreference ?? undefined);
        if (shouldReloadCurrent && previousResolved) {
          await loadIndex(index, false, {
            resolvedOverride: previousResolved,
            preserveListenBrainzSession: true,
          });
          if (resumePositionMs > 0) await seek(resumePositionMs);
          if (state === "playing") await play();
        }
      } catch (rollbackError) {
        playerLog.error(`[session] output rollback failed: ${String(rollbackError)}`);
      }
      throw switchError;
    }

    store.set("player.outputDevice", deviceId);
    publishCoreControlEvent({
      type: "deviceChanged",
      data: { defaultDevice: player.getDefaultDeviceName() ?? null },
    });

    if (shouldReloadCurrent && targetResolved) {
      try {
        await loadIndex(index, false, {
          resolvedOverride: targetResolved,
          preserveListenBrainzSession: true,
        });
        if (resumePositionMs > 0) await seek(resumePositionMs);
        if (shouldResumePlaying) await play();
      } catch (loadError) {
        if (managedDirectInput) void discardDirectInput(managedDirectInput);
        throw loadError;
      }
    }
  } finally {
    scheduleNextPlaybackPreload();
  }
};

/** 当前 Native 实际选择的输出设备，而不是仅返回持久化偏好。 */
export const getSelectedOutputDevice = (): string | null =>
  isUpnpOutput(store.get("player.outputDevice"))
    ? (getSelectedUpnpOutput() ?? store.get("player.outputDevice") ?? null)
    : (getPlayer().getSelectedDeviceName() ?? null);

/** Core Control 使用的当前输出状态；UPnP 不改变既有 PlayerStatus schema。 */
export const getPlaybackStatus = (): PlayerStatus => {
  const player = getPlayer();
  if (isUpnpSelected()) {
    const remote = getUpnpOutputStatus();
    return {
      state: remote.state,
      position: remote.position,
      duration: remote.duration,
      volume: player.getVolume(),
      speed: player.getSpeed(),
      isFinished: remote.isFinished,
    };
  }
  const raw = player.getStatus();
  return {
    state: raw.state as PlayerStatus["state"],
    position: toDisplayPositionMs(toMs(raw.position)),
    duration: toDisplayDurationMs(toMs(raw.duration)),
    volume: raw.volume,
    speed: player.getSpeed(),
    isFinished: raw.isFinished,
  };
};
