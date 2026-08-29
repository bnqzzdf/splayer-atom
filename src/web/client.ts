import { assertCoreProtocolCompatible } from "@shared/constants/coreProtocol";
import type { CoreInfo } from "@shared/types/core";
import type {
  AudioDevice,
  PlaybackQueueItem,
  PlaybackSessionSnapshot,
  PlayerStatus,
  RepeatMode,
  ShuffleMode,
  Track,
} from "@shared/types/player";

export type HeadlessSession = PlaybackSessionSnapshot;

export interface OutputSnapshot {
  selected: string | null;
  data: AudioDevice[];
}

const host = window.location.hostname || "127.0.0.1";
const dev = import.meta.env.DEV;
export const apiOrigin = dev
  ? `${window.location.protocol}//${host}:14559`
  : window.location.origin;
export const wsOrigin = dev
  ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${host}:14559`
  : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;

const rawRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${apiOrigin}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await response.json().catch(() => null)) as T | { error?: string } | null;
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data ? data.error : null;
    throw new Error(message || `HTTP ${response.status}`);
  }
  return data as T;
};

let coreInfoPromise: Promise<CoreInfo> | null = null;

/** 获取并缓存 Core 兼容信息；网络失败允许下一次请求重新探测。 */
export const getCoreInfo = (): Promise<CoreInfo> => {
  coreInfoPromise ??= rawRequest<CoreInfo>("/info").catch((error) => {
    coreInfoPromise = null;
    throw error;
  });
  return coreInfoPromise;
};

/** Web Control 在任何 domain 请求前先验证 Core Protocol。 */
export const ensureCoreProtocolCompatible = async (): Promise<CoreInfo> => {
  const info = await getCoreInfo();
  assertCoreProtocolCompatible(info);
  return info;
};

export const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  if (path !== "/info") await ensureCoreProtocolCompatible();
  return rawRequest<T>(path, init);
};

export const connectWebEvents = (
  onEvent: (event: { type: string; data?: unknown }) => void,
): (() => void) => {
  let disposed = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let statusTimer: number | null = null;

  const sendVisibility = (): void => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ op: "visibility", visible: document.visibilityState === "visible" }));
  };

  const syncSnapshots = async (): Promise<void> => {
    try {
      const [session, status] = await Promise.all([
        request<PlaybackSessionSnapshot>("/session"),
        request<PlayerStatus>("/status"),
      ]);
      if (disposed || ws?.readyState !== WebSocket.OPEN) return;
      onEvent({ type: "session", data: session });
      onEvent({ type: "status", data: status });
      onEvent({ type: "deviceChanged" });
    } catch {
      // 连接建立后服务仍可能处于启动窗口，后续实时事件会继续恢复状态。
    }
  };

  /** 高频 position 不走 WS；正式 Web 用轻量 status snapshot 驱动进度。 */
  const syncStatus = async (): Promise<void> => {
    if (disposed || document.visibilityState !== "visible" || ws?.readyState !== WebSocket.OPEN)
      return;
    try {
      const status = await request<PlayerStatus>("/status");
      if (disposed || ws?.readyState !== WebSocket.OPEN) return;
      onEvent({ type: "status", data: status });
    } catch {
      // WS 重连和下一轮 snapshot 会继续恢复状态。
    }
  };

  const stopStatusPolling = (): void => {
    if (statusTimer !== null) window.clearInterval(statusTimer);
    statusTimer = null;
  };

  const startStatusPolling = (): void => {
    stopStatusPolling();
    statusTimer = window.setInterval(() => void syncStatus(), 500);
  };

  const handleVisibility = (): void => {
    sendVisibility();
    if (document.visibilityState === "visible") void syncStatus();
  };

  const scheduleReconnect = (): void => {
    if (disposed || reconnectTimer !== null) return;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, 1000);
  };

  const connect = async (): Promise<void> => {
    if (disposed) return;
    try {
      await ensureCoreProtocolCompatible();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onEvent({ type: "coreCompatibilityError", data: { error: message } });
      if (!message.startsWith("CORE_PROTOCOL_UNSUPPORTED:")) scheduleReconnect();
      return;
    }
    if (disposed) return;
    ws = new WebSocket(`${wsOrigin}/ws`);
    ws.onopen = () => {
      sendVisibility();
      void syncSnapshots();
      startStatusPolling();
    };
    ws.onmessage = (message) => {
      try {
        const payload = JSON.parse(String(message.data)) as {
          kind?: string;
          type?: string;
          data?: unknown;
        };
        if (payload.kind === "event" && payload.type) {
          onEvent({ type: payload.type, data: payload.data });
        }
      } catch {
        // HTTP snapshots remain authoritative if a malformed external message is received.
      }
    };
    ws.onclose = () => {
      stopStatusPolling();
      scheduleReconnect();
    };
  };

  document.addEventListener("visibilitychange", handleVisibility);
  void connect();
  return () => {
    disposed = true;
    document.removeEventListener("visibilitychange", handleVisibility);
    stopStatusPolling();
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    ws?.close();
    ws = null;
  };
};

const HEADLESS_IMAGE_CACHE = /^\/cache\/(covers|artists|backgrounds)(?:\/|$)/;

/** 识别由 Headless 图像缓存产生的 HTTP URL，并返回可复用路径。 */
const headlessCachePath = (value: string): string | null => {
  try {
    const url = new URL(value);
    const current = new URL(apiOrigin);
    if (!HEADLESS_IMAGE_CACHE.test(url.pathname)) return null;
    // 旧队列可能由 localhost 页面写入；同一 Headless 端口的缓存 URL 仍应映射到当前浏览器主机。
    if (url.port !== current.port && url.port !== "14558") return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
};

/** 将 Electron cache:// 或旧 Headless 绝对图像 URL 映射到当前 Web 服务。 */
export const webAssetUrl = (value: string | undefined): string | undefined => {
  if (!value) return value;
  if (value.startsWith("cache://")) {
    const rest = value.slice("cache://".length);
    return `${apiOrigin}/cache/${rest}`;
  }
  const cachePath = headlessCachePath(value);
  return cachePath ? `${apiOrigin}${cachePath}` : value;
};

/** 将 Web 展示 URL 还原为主进程可持久化的 cache:// 规范形式。 */
export const serverAssetUrl = (value: string | undefined): string | undefined => {
  if (!value || value.startsWith("cache://")) return value;
  const cachePath = headlessCachePath(value);
  return cachePath ? `cache://${cachePath.slice("/cache/".length)}` : value;
};

export const headlessClient = {
  tracks: (): Promise<{ data: Track[]; total: number }> => request("/library/tracks"),
  scanDirs: (): Promise<{ data: string[] }> => request("/library/scan-dirs"),
  setScanDirs: (dirs: string[]): Promise<{ success: boolean; data: string[] }> =>
    request("/library/scan-dirs", { method: "POST", body: JSON.stringify({ dirs }) }),
  scanLibrary: (incremental = true): Promise<{ success: boolean; error?: string }> =>
    request("/library/scan", { method: "POST", body: JSON.stringify({ incremental }) }),
  isScanning: (): Promise<{ data: boolean }> => request("/library/is-scanning"),
  session: (): Promise<HeadlessSession> => request("/session"),
  status: (): Promise<PlayerStatus> => request("/status"),
  nowPlaying: (): Promise<{ track: Track | null }> => request("/now-playing"),
  playTrack: (track: Track): Promise<HeadlessSession> =>
    request("/session/play-track", { method: "POST", body: JSON.stringify({ track }) }),
  replaceQueue: (items: PlaybackQueueItem[], startIndex = 0): Promise<HeadlessSession> =>
    request("/session/queue", {
      method: "POST",
      body: JSON.stringify({ items, startIndex, autoPlay: true }),
    }),
  appendQueue: (items: PlaybackQueueItem[]): Promise<HeadlessSession> =>
    request("/session/queue/append", { method: "POST", body: JSON.stringify({ items }) }),
  insertQueue: (items: PlaybackQueueItem[], index: number): Promise<HeadlessSession> =>
    request("/session/queue/insert", {
      method: "POST",
      body: JSON.stringify({ items, index }),
    }),
  moveQueue: (fromIndex: number, toIndex: number): Promise<HeadlessSession> =>
    request("/session/queue/move", {
      method: "POST",
      body: JSON.stringify({ fromIndex, toIndex }),
    }),
  selectQueueIndex: (index: number, autoPlay = true): Promise<HeadlessSession> =>
    request("/session/queue/select", {
      method: "POST",
      body: JSON.stringify({ index, autoPlay }),
    }),
  removeQueueIndex: (index: number): Promise<HeadlessSession> =>
    request(`/session/queue/${index}`, { method: "DELETE" }),
  clearQueue: (): Promise<HeadlessSession> => request("/session/queue", { method: "DELETE" }),
  setRepeat: (mode: RepeatMode): Promise<HeadlessSession> =>
    request("/session/repeat", { method: "POST", body: JSON.stringify({ mode }) }),
  setShuffle: (mode: ShuffleMode): Promise<HeadlessSession> =>
    request("/session/shuffle", { method: "POST", body: JSON.stringify({ mode }) }),
  play: (): Promise<{ ok: boolean }> => request("/play", { method: "POST" }),
  pause: (): Promise<{ ok: boolean }> => request("/pause", { method: "POST" }),
  stop: (): Promise<{ ok: boolean }> => request("/stop", { method: "POST" }),
  next: (): Promise<{ ok: boolean }> => request("/next", { method: "POST" }),
  prev: (): Promise<{ ok: boolean }> => request("/prev", { method: "POST" }),
  seek: (positionMs: number): Promise<{ ok: boolean }> =>
    request("/seek", { method: "POST", body: JSON.stringify({ positionMs }) }),
  outputs: (): Promise<OutputSnapshot> => request("/output/devices"),
  selectOutput: (deviceId: string | null): Promise<{ ok: boolean; selected: string | null }> =>
    request("/output/select", { method: "POST", body: JSON.stringify({ deviceId }) }),
  connectEvents: connectWebEvents,
};
