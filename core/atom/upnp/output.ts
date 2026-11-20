import type { AudioDevice, PlayerState } from "@shared/types/player";
import { scanUpnpRenderers, type UpnpRendererDescriptor } from "@main/atom/upnp/discovery";
import {
  getPositionInfo,
  getTransportInfo,
  pauseAvTransport,
  playAvTransport,
  seekAvTransport,
  setAvTransportUri,
  stopAvTransport,
} from "@main/atom/upnp/transport";
import {
  registerMediaFile,
  releaseMediaResource,
  shutdownUpnpMedia,
  type UpnpMediaResource,
} from "@main/atom/upnp/media";

const POLL_INTERVAL_MS = 1000;
const NEAR_END_STALL_POLLS = 2;

export interface UpnpOutputStatus {
  state: PlayerState;
  position: number;
  duration: number;
  isFinished: boolean;
}

export interface UpnpOutputObservation {
  generation: number;
  status: UpnpOutputStatus;
}

export interface UpnpEndTracker {
  seenPlaying: boolean;
  reachedNearEnd: boolean;
  lastPlayingPosition: number;
  stalledNearEndPolls: number;
}

export const createUpnpEndTracker = (): UpnpEndTracker => ({
  seenPlaying: false,
  reachedNearEnd: false,
  lastPlayingPosition: -1,
  stalledNearEndPolls: 0,
});

export const isNearUpnpEnd = (positionMs: number, durationMs: number): boolean => {
  if (durationMs <= 0 || positionMs <= 0) return false;
  const tolerance = Math.max(2000, Math.min(5000, Math.round(durationMs * 0.02)));
  return positionMs >= Math.max(0, durationMs - tolerance);
};

// 部分 Renderer（如 DirettaRenderer syncBuffer）在单曲播完后仍维持 PLAYING，
// 需结合曲尾位置停滞或曲尾后 RelTime 归零判定自然播完。
export const advanceUpnpEndTracker = (
  tracker: UpnpEndTracker,
  sample: {
    state: PlayerState;
    positionMs: number;
    durationMs: number;
    positionAvailable: boolean;
  },
): { tracker: UpnpEndTracker; isFinished: boolean } => {
  const { state, positionMs, durationMs, positionAvailable } = sample;
  if (state === "playing") {
    const next: UpnpEndTracker = { ...tracker, seenPlaying: true };
    if (!positionAvailable || durationMs <= 0) return { tracker: next, isFinished: false };
    if (tracker.reachedNearEnd && positionMs === 0) return { tracker: next, isFinished: true };
    if (isNearUpnpEnd(positionMs, durationMs)) {
      if (tracker.seenPlaying) next.reachedNearEnd = true;
      next.stalledNearEndPolls =
        tracker.lastPlayingPosition >= 0 && positionMs <= tracker.lastPlayingPosition
          ? tracker.stalledNearEndPolls + 1
          : 0;
    } else {
      next.reachedNearEnd = false;
      next.stalledNearEndPolls = 0;
    }
    next.lastPlayingPosition = positionMs;
    return { tracker: next, isFinished: next.stalledNearEndPolls >= NEAR_END_STALL_POLLS };
  }
  const next: UpnpEndTracker = {
    ...tracker,
    lastPlayingPosition: -1,
    stalledNearEndPolls: 0,
  };
  const isFinished =
    state === "stopped" &&
    tracker.seenPlaying &&
    (isNearUpnpEnd(positionMs, durationMs) || tracker.reachedNearEnd);
  return { tracker: next, isFinished };
};

interface UpnpLoadOptions {
  filePath: string;
  title: string;
  durationMs?: number;
  mime?: string;
  autoPlay?: boolean;
  deleteOnRelease?: boolean;
}

const descriptors = new Map<string, UpnpRendererDescriptor>();
let selectedId: string | null = null;
let selectedDescriptor: UpnpRendererDescriptor | null = null;
let currentResource: UpnpMediaResource | null = null;
let generation = 0;
let positionEpoch = 0;
let endTracker: UpnpEndTracker = createUpnpEndTracker();
let status: UpnpOutputStatus = {
  state: "stopped",
  position: 0,
  duration: 0,
  isFinished: false,
};
let pollTimer: NodeJS.Timeout | null = null;
let refreshPending: Promise<void> | null = null;
let observer: ((observation: UpnpOutputObservation) => void) | null = null;
let commandChain: Promise<void> = Promise.resolve();

const runCommand = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = commandChain.then(operation);
  commandChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const notifyObserver = (): void => {
  observer?.({ generation, status: { ...status } });
};

const mapTransportState = (value: string): PlayerState => {
  switch (value.toUpperCase()) {
    case "PLAYING":
      return "playing";
    case "PAUSED_PLAYBACK":
    case "PAUSED_RECORDING":
      return "paused";
    case "TRANSITIONING":
      return "loading";
    default:
      return "stopped";
  }
};

const stopPolling = (): void => {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
};

const ensureDescriptor = async (): Promise<UpnpRendererDescriptor> => {
  if (!selectedId) throw new Error("未选择 UPnP Renderer");
  if (selectedDescriptor?.id === selectedId) return selectedDescriptor;
  const cached = descriptors.get(selectedId);
  if (cached) {
    selectedDescriptor = cached;
    return cached;
  }
  await scanUpnpDevices();
  const discovered = descriptors.get(selectedId);
  if (!discovered) throw new Error(`UPnP Renderer 不可用: ${selectedId}`);
  selectedDescriptor = discovered;
  return discovered;
};

const refreshStatus = async (): Promise<void> => {
  if (refreshPending) return refreshPending;
  refreshPending = (async () => {
    const refreshGeneration = generation;
    const refreshEpoch = positionEpoch;
    const renderer = await ensureDescriptor();
    const transportState = await getTransportInfo(renderer);
    let positionAvailable = true;
    const position = await getPositionInfo(renderer).catch(() => {
      positionAvailable = false;
      return {
        positionMs: status.position,
        durationMs: status.duration,
      };
    });
    if (refreshGeneration !== generation || refreshEpoch !== positionEpoch) return;
    const nextState = mapTransportState(transportState);
    const duration = position.durationMs || status.duration;
    const evaluated = advanceUpnpEndTracker(endTracker, {
      state: nextState,
      positionMs: position.positionMs,
      durationMs: duration,
      positionAvailable,
    });
    endTracker = evaluated.tracker;
    const observedPosition =
      (nextState === "stopped" || evaluated.isFinished) &&
      position.positionMs === 0 &&
      status.position > 0
        ? status.position
        : position.positionMs;
    status = {
      state: nextState,
      position: observedPosition,
      duration,
      isFinished: evaluated.isFinished,
    };
    notifyObserver();
  })().finally(() => {
    refreshPending = null;
  });
  return refreshPending;
};

const startPolling = (): void => {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    void refreshStatus().catch(() => {});
  }, POLL_INTERVAL_MS);
  pollTimer.unref();
};

/** 扫描当前 UPnP Renderer 并投影成现有 AudioDevice。 */
export const scanUpnpDevices = async (): Promise<AudioDevice[]> => {
  const found = await scanUpnpRenderers();
  for (const renderer of found) descriptors.set(renderer.id, renderer);
  return found.map((renderer) => ({
    id: renderer.id,
    name: renderer.name,
    isDefault: false,
  }));
};

/** 只记录 Core 已选择的 UPnP identity；descriptor 可在真正播放前懒发现。 */
export const selectUpnpOutput = (deviceId: string): void => {
  if (!deviceId.startsWith("upnp:")) throw new Error(`非法 UPnP output id: ${deviceId}`);
  selectedId = deviceId;
  selectedDescriptor = descriptors.get(deviceId) ?? null;
};

export const getSelectedUpnpOutput = (): string | null => selectedId;

/** 只验证目标 Renderer 当前可发现，不改变持久化选择。 */
export const prepareUpnpOutput = async (deviceId: string): Promise<void> => {
  if (!deviceId.startsWith("upnp:")) throw new Error(`非法 UPnP output id: ${deviceId}`);
  if (!descriptors.has(deviceId)) await scanUpnpDevices();
  if (!descriptors.has(deviceId)) throw new Error(`UPnP Renderer 不可用: ${deviceId}`);
};

/** Core session 订阅当前 UPnP 执行观察；只允许一个权威消费者。 */
export const setUpnpOutputObserver = (
  listener: ((observation: UpnpOutputObservation) => void) | null,
): void => {
  observer = listener;
};

/** 为当前 Renderer 设置一个已经准备好的本地媒体文件。 */
export const loadUpnpFile = async (options: UpnpLoadOptions): Promise<void> => {
  const nextGeneration = ++generation;
  ++positionEpoch;
  endTracker = createUpnpEndTracker();
  stopPolling();
  status = {
    state: "loading",
    position: 0,
    duration: Math.max(0, options.durationMs ?? 0),
    isFinished: false,
  };
  notifyObserver();
  await runCommand(async () => {
    const renderer = await ensureDescriptor();
    const rendererHost = new URL(renderer.location).hostname;
    const resource = await registerMediaFile(options.filePath, {
      rendererHost,
      title: options.title,
      durationMs: options.durationMs,
      mime: options.mime,
      deleteOnRelease: options.deleteOnRelease,
    });
    try {
      await setAvTransportUri(renderer, resource);
      if (nextGeneration !== generation) {
        await releaseMediaResource(resource);
        return;
      }
      const previous = currentResource;
      currentResource = resource;
      await releaseMediaResource(previous);
      status = {
        state: "stopped",
        position: 0,
        duration: resource.durationMs,
        isFinished: false,
      };
      notifyObserver();
    } catch (error) {
      await releaseMediaResource(resource);
      throw error;
    }
  });
  if (options.autoPlay !== false && nextGeneration === generation) await playUpnpOutput();
};

export const playUpnpOutput = async (): Promise<void> => {
  await runCommand(async () => {
    const renderer = await ensureDescriptor();
    await playAvTransport(renderer);
  });
  startPolling();
  await refreshStatus().catch(() => {
    status = { ...status, state: "playing" };
    notifyObserver();
  });
};

export const pauseUpnpOutput = async (): Promise<void> => {
  ++positionEpoch;
  endTracker = {
    ...endTracker,
    lastPlayingPosition: -1,
    stalledNearEndPolls: 0,
  };
  await runCommand(async () => {
    const renderer = await ensureDescriptor();
    await pauseAvTransport(renderer);
  });
  await refreshStatus().catch(() => {
    status = { ...status, state: "paused" };
    notifyObserver();
  });
};

export const stopUpnpOutput = async (): Promise<void> => {
  ++generation;
  ++positionEpoch;
  endTracker = createUpnpEndTracker();
  stopPolling();
  try {
    await runCommand(async () => {
      const renderer = selectedId ? await ensureDescriptor() : null;
      if (renderer) await stopAvTransport(renderer);
    });
  } finally {
    const previous = currentResource;
    currentResource = null;
    status = { state: "stopped", position: 0, duration: 0, isFinished: false };
    notifyObserver();
    await releaseMediaResource(previous);
  }
};

const resetSeekEndTracker = (): void => {
  ++positionEpoch;
  endTracker = {
    ...endTracker,
    reachedNearEnd: false,
    lastPlayingPosition: -1,
    stalledNearEndPolls: 0,
  };
};

export const seekUpnpOutput = async (positionMs: number): Promise<void> => {
  const target = Math.max(0, positionMs);
  resetSeekEndTracker();
  await runCommand(async () => {
    const renderer = await ensureDescriptor();
    await seekAvTransport(renderer, target);
  });
  resetSeekEndTracker();
  status = { ...status, position: target, isFinished: false };
  notifyObserver();
};

export const getUpnpOutputStatus = (): UpnpOutputStatus => ({ ...status });

/** 释放 UPnP 执行态，不影响 Core 持久化的 output preference。 */
export const releaseUpnpOutput = async (): Promise<void> => {
  ++generation;
  ++positionEpoch;
  endTracker = createUpnpEndTracker();
  stopPolling();
  const previous = currentResource;
  currentResource = null;
  selectedDescriptor = null;
  selectedId = null;
  status = { state: "stopped", position: 0, duration: 0, isFinished: false };
  notifyObserver();
  await releaseMediaResource(previous);
  await shutdownUpnpMedia();
};
