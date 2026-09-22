import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeFileSync as atomicWriteSync } from "atomically";
import type { Track } from "@shared/types/player";
import type {
  ListenBrainzRuntimeState,
  ListenBrainzStatus,
  ListenBrainzTrackSnapshot,
} from "@shared/types/listenbrainz";
import { runtimeSecretCodec } from "@main/atom/runtime/secrets";
import {
  spawnListenBrainzProcess,
  type ListenBrainzProcess,
} from "@main/atom/runtime/listenbrainzProcess";
import { runtimeEnvironment } from "@main/atom/runtime/environment";
import { createPlayProgress } from "@main/services/playProgress";
import { store } from "@main/store";
import { configDir } from "@main/utils/paths";
import { coreLog } from "@main/utils/logger";

const CREDENTIAL_FILE = path.join(configDir, "listenbrainz.json");
const VALIDATE_TIMEOUT_MS = 15_000;
const CHILD_RESTART_DELAY_MS = 5000;

interface PersistedCredential {
  encodedToken: string;
  account: string;
}

interface RuntimeCredential {
  token: string;
  account: string;
}

interface ListenSession {
  artistName: string;
  trackName: string;
  releaseName?: string;
  durationMs: number;
  trackNumber?: number;
  listenedAt: number | null;
  nowPlayingSent: boolean;
}

type ChildMessage =
  | {
      type: "status";
      state: Exclude<ListenBrainzRuntimeState, "disabled" | "starting">;
      pending: number;
      dead: number;
      lastError: string | null;
    }
  | { type: "validateResult"; requestId: number; ok: boolean; account?: string; error?: string }
  | { type: "captured"; captureId: string };

let credentialLoaded = false;
let credential: RuntimeCredential | null = null;
let child: ListenBrainzProcess | null = null;
let stoppingChild = false;
let playing = false;
let current: ListenSession | null = null;
let thresholdTimer: ReturnType<typeof setTimeout> | null = null;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let validateRequestId = 0;
const unackedCaptures = new Map<string, ListenBrainzTrackSnapshot>();
const validateWaiters = new Map<
  number,
  {
    resolve: (account: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

let runtimeState: ListenBrainzRuntimeState = "disabled";
let pending = 0;
let dead = 0;
let lastError: string | null = null;

const isEnabled = (): boolean => store.get("listenbrainz.enabled") === true;
const sendNowPlayingEnabled = (): boolean => store.get("listenbrainz.sendNowPlaying") === true;

const scrobbleThresholdMs = (durationSec: number): number =>
  durationSec > 0 ? Math.min(durationSec / 2, 240) * 1000 : Infinity;

const loadCredential = (): RuntimeCredential | null => {
  if (credentialLoaded) return credential;
  credentialLoaded = true;
  try {
    const parsed = JSON.parse(fs.readFileSync(CREDENTIAL_FILE, "utf8")) as PersistedCredential;
    const token = runtimeSecretCodec.decode(parsed.encodedToken ?? "").trim();
    const account = String(parsed.account ?? "").trim();
    credential = token && account ? { token, account } : null;
  } catch {
    credential = null;
  }
  return credential;
};

const saveCredential = (token: string, account: string): void => {
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  if (!runtimeSecretCodec.protectedAtRest) {
    coreLog.warn(
      "ListenBrainz token 使用 0600 credential file 保存，当前 runtime secret codec 未加密",
    );
  }
  const persisted: PersistedCredential = {
    encodedToken: runtimeSecretCodec.encode(token),
    account,
  };
  atomicWriteSync(CREDENTIAL_FILE, JSON.stringify(persisted, null, 2));
  fs.chmodSync(CREDENTIAL_FILE, 0o600);
  credentialLoaded = true;
  credential = { token, account };
};

const removeCredential = (): void => {
  credentialLoaded = true;
  credential = null;
  try {
    fs.rmSync(CREDENTIAL_FILE, { force: true });
  } catch (error) {
    coreLog.warn("删除 ListenBrainz credential 失败", error);
  }
};

const sendToChild = (message: unknown): boolean => {
  if (!child) return false;
  try {
    child.send(message);
    return true;
  } catch (error) {
    coreLog.warn("发送 ListenBrainz child 消息失败", error);
    return false;
  }
};

const clearThresholdTimer = (): void => {
  if (thresholdTimer) clearTimeout(thresholdTimer);
  thresholdTimer = null;
};

const clearRestartTimer = (): void => {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = null;
};

const sendPendingCaptures = (): void => {
  if (!child) return;
  for (const [captureId, track] of unackedCaptures) {
    sendToChild({ type: "listen", captureId, track });
  }
};

const toSnapshot = (session: ListenSession): ListenBrainzTrackSnapshot | null => {
  if (!session.listenedAt) return null;
  return {
    artistName: session.artistName,
    trackName: session.trackName,
    releaseName: session.releaseName,
    durationMs: session.durationMs,
    trackNumber: session.trackNumber,
    listenedAt: session.listenedAt,
  };
};

const progress = createPlayProgress<ListenSession>({
  thresholdMs: scrobbleThresholdMs,
  shouldFire: () => isEnabled() && Boolean(loadCredential()) && child !== null,
  onThreshold: (session) => {
    const snapshot = toSnapshot(session);
    if (!snapshot) return;
    const captureId = randomUUID();
    unackedCaptures.set(captureId, snapshot);
    sendPendingCaptures();
  },
});

const scheduleThreshold = (): void => {
  clearThresholdTimer();
  if (!isEnabled() || !playing || !current || !child || !loadCredential() || progress.hasFired())
    return;
  const threshold = progress.thresholdMs();
  if (!Number.isFinite(threshold)) return;
  const remaining = Math.max(0, threshold - progress.elapsedMs());
  thresholdTimer = setTimeout(
    () => {
      thresholdTimer = null;
      progress.tick();
      if (!progress.hasFired()) scheduleThreshold();
    },
    Math.max(1, remaining),
  );
};

const invalidateNowPlaying = (): void => {
  if (current) current.nowPlayingSent = false;
};

const sendPlayingNow = (): void => {
  if (
    !current ||
    current.nowPlayingSent ||
    !playing ||
    !sendNowPlayingEnabled() ||
    !loadCredential()
  )
    return;
  const snapshot = toSnapshot(current);
  if (!snapshot) return;
  if (sendToChild({ type: "nowPlaying", track: snapshot })) current.nowPlayingSent = true;
};

const configureChild = (): void => {
  const linked = loadCredential();
  sendToChild({
    type: "configure",
    token: linked?.token ?? "",
    sendNowPlaying: sendNowPlayingEnabled(),
    appVersion: runtimeEnvironment.appVersion,
  });
};

const rejectValidateWaiters = (message: string): void => {
  for (const waiter of validateWaiters.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error(message));
  }
  validateWaiters.clear();
};

const handleChildMessage = (message: unknown): void => {
  if (!message || typeof message !== "object") return;
  const value = message as ChildMessage;
  if (value.type === "status") {
    runtimeState = value.state;
    pending = value.pending;
    dead = value.dead;
    lastError = value.lastError;
    return;
  }
  if (value.type === "validateResult") {
    const waiter = validateWaiters.get(value.requestId);
    if (!waiter) return;
    validateWaiters.delete(value.requestId);
    clearTimeout(waiter.timer);
    if (value.ok && value.account) waiter.resolve(value.account);
    else waiter.reject(new Error(value.error || "ListenBrainz token 无效"));
    return;
  }
  if (value.type === "captured") {
    unackedCaptures.delete(value.captureId);
  }
};

const startChild = (): void => {
  if (!isEnabled() || child) return;
  clearRestartTimer();
  runtimeState = "starting";
  lastError = null;
  stoppingChild = false;
  try {
    const next = spawnListenBrainzProcess();
    child = next;
    next.stdout?.on("data", (chunk) => coreLog.debug(`[ListenBrainz] ${String(chunk).trimEnd()}`));
    next.stderr?.on("data", (chunk) => coreLog.warn(`[ListenBrainz] ${String(chunk).trimEnd()}`));
    next.onMessage(handleChildMessage);
    next.onExit((code) => {
      if (child !== next) return;
      child = null;
      rejectValidateWaiters("ListenBrainz child 已退出");
      clearThresholdTimer();
      if (stoppingChild || !isEnabled()) {
        runtimeState = "disabled";
        return;
      }
      runtimeState = "error";
      invalidateNowPlaying();
      lastError = `ListenBrainz child 异常退出${code == null ? "" : ` (${code})`}`;
      coreLog.warn(lastError);
      clearRestartTimer();
      restartTimer = setTimeout(() => {
        restartTimer = null;
        if (!isEnabled() || child) return;
        startChild();
        scheduleThreshold();
        sendPlayingNow();
      }, CHILD_RESTART_DELAY_MS);
    });
    configureChild();
    sendPendingCaptures();
  } catch (error) {
    child = null;
    runtimeState = "error";
    lastError = error instanceof Error ? error.message : String(error);
    coreLog.warn("启动 ListenBrainz child 失败", error);
  }
};

const stopChild = (): void => {
  clearThresholdTimer();
  clearRestartTimer();
  rejectValidateWaiters("ListenBrainz 已关闭");
  if (child) {
    stoppingChild = true;
    sendToChild({ type: "shutdown" });
    child.kill();
    child = null;
  }
  pending = 0;
  dead = 0;
  lastError = null;
  runtimeState = "disabled";
};

/** Core 启动时按持久化开关惰性创建 runtime；disabled 不创建任何 child。 */
export const initListenBrainz = (): void => {
  if (isEnabled()) startChild();
  else runtimeState = "disabled";
};

export const shutdownListenBrainz = (): void => {
  progress.reset();
  current = null;
  playing = false;
  stopChild();
};

/** Core Settings mutation 后应用唯一 runtime 副作用。 */
export const applyListenBrainzSettingChange = (keyPath: string): void => {
  if (keyPath === "listenbrainz.enabled") {
    if (isEnabled()) {
      startChild();
      scheduleThreshold();
      sendPlayingNow();
    } else {
      progress.reset();
      current = null;
      playing = false;
      stopChild();
    }
    return;
  }
  if (keyPath === "listenbrainz.sendNowPlaying" && child) {
    configureChild();
    invalidateNowPlaying();
    if (sendNowPlayingEnabled()) sendPlayingNow();
    else sendToChild({ type: "clearNowPlaying" });
  }
};

export const getListenBrainzStatus = (): ListenBrainzStatus => ({
  enabled: isEnabled(),
  sendNowPlaying: sendNowPlayingEnabled(),
  linked: Boolean(loadCredential()),
  account: loadCredential()?.account ?? null,
  state: isEnabled() ? runtimeState : "disabled",
  pending,
  dead,
  lastError,
  processActive: child !== null,
});

/** 仅 enabled 时允许验证并保存 token，保证关闭状态绝不为 ListenBrainz 创建进程。 */
export const linkListenBrainz = async (tokenInput: string): Promise<ListenBrainzStatus> => {
  if (!isEnabled()) throw new Error("请先启用 ListenBrainz");
  const token = tokenInput.trim();
  if (!token) throw new Error("ListenBrainz token 不能为空");
  startChild();
  if (!child) throw new Error(lastError || "ListenBrainz child 未启动");

  const requestId = ++validateRequestId;
  const account = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      validateWaiters.delete(requestId);
      reject(new Error("ListenBrainz token 验证超时"));
    }, VALIDATE_TIMEOUT_MS);
    validateWaiters.set(requestId, { resolve, reject, timer });
    if (!sendToChild({ type: "validate", requestId, token })) {
      clearTimeout(timer);
      validateWaiters.delete(requestId);
      reject(new Error("ListenBrainz child 不可用"));
    }
  });

  saveCredential(token, account);
  configureChild();
  scheduleThreshold();
  invalidateNowPlaying();
  sendPlayingNow();
  return getListenBrainzStatus();
};

export const unlinkListenBrainz = (): ListenBrainzStatus => {
  if (child) sendToChild({ type: "clearNowPlaying" });
  invalidateNowPlaying();
  removeCredential();
  if (child) configureChild();
  clearThresholdTimer();
  return getListenBrainzStatus();
};

export const clearListenBrainzOutbox = (): void => {
  if (!isEnabled() || !child) throw new Error("ListenBrainz 未启用");
  sendToChild({ type: "clearOutbox" });
};

/** 新一轮 authoritative track load；普通播放与 Direct boundary 共用。 */
export const onTrackLoaded = (track: Track | null, durationMs: number, autoPlay: boolean): void => {
  if (!isEnabled()) return;
  startChild();
  const artistName =
    track?.artists
      ?.map((artist) => artist.name.trim())
      .filter(Boolean)
      .join(", ") ?? "";
  const trackName = track?.title?.trim() ?? "";
  const valid = Boolean(track && artistName && trackName && durationMs > 0);
  current = valid
    ? {
        artistName,
        trackName,
        releaseName: track?.album?.name?.trim() || undefined,
        durationMs,
        trackNumber: track?.track,
        listenedAt: autoPlay ? Math.floor(Date.now() / 1000) : null,
        nowPlayingSent: false,
      }
    : null;
  playing = autoPlay;
  progress.load(durationMs / 1000, current, autoPlay);
  sendPlayingNow();
  scheduleThreshold();
};

export const onState = (nextPlaying: boolean): void => {
  if (!isEnabled()) return;
  playing = nextPlaying;
  if (current && nextPlaying && current.listenedAt == null) {
    current.listenedAt = Math.floor(Date.now() / 1000);
  }
  progress.setPlaying(nextPlaying);
  if (nextPlaying) sendPlayingNow();
  scheduleThreshold();
};

export const onEnded = (): void => {
  if (!isEnabled()) return;
  clearThresholdTimer();
  progress.end();
  current = null;
  playing = false;
};
