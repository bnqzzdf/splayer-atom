import type {
  CoreControlEvent,
  CoreEventsApi,
  CorePlayerProjectionEvent,
} from "@shared/types/coreEvents";
import type { PlaybackSessionSnapshot, PlayerStatus, Track } from "@shared/types/player";
import { controlAssetUrl } from "./controlAssets";
import { ensureCoreProtocolCompatible, request } from "./controlClient";

export interface ControlEvent {
  type: string;
  data?: unknown;
}

type CoreEventType = CoreControlEvent["type"];
type CoreEventOf<T extends CoreEventType> = Extract<CoreControlEvent, { type: T }>;

const listeners = new Set<(event: ControlEvent) => void>();
let disconnectTransport: (() => void) | null = null;

const emit = (event: ControlEvent): void => {
  for (const listener of listeners) listener(event);
};

const mapTrack = (track: Track): Track => ({
  ...track,
  cover: controlAssetUrl(track.cover),
  coverOriginal: controlAssetUrl(track.coverOriginal),
});

const mapSession = (session: PlaybackSessionSnapshot): PlaybackSessionSnapshot => ({
  ...session,
  queue: session.queue.map((item) => ({ ...item, track: mapTrack(item.track) })),
  originalQueue:
    session.originalQueue?.map((item) => ({ ...item, track: mapTrack(item.track) })) ?? null,
  current: session.current ? mapTrack(session.current) : null,
});

export const isCorePlayerProjectionEvent = (
  event: ControlEvent,
): event is CorePlayerProjectionEvent =>
  event.data !== undefined &&
  (event.type === "status" ||
    event.type === "trackLoaded" ||
    event.type === "position" ||
    event.type === "fftData" ||
    event.type === "error" ||
    event.type === "deviceChanged" ||
    event.type === "session");

export const isCoreControlEvent = (event: ControlEvent): event is CoreControlEvent =>
  isCorePlayerProjectionEvent(event) ||
  (event.data !== undefined &&
    (event.type === "providerSessions" ||
      event.type === "libraryScanProgress" ||
      event.type === "downloadState" ||
      event.type === "downloadProgress" ||
      event.type === "streamingLibraryUpdated" ||
      event.type === "lyricOffset"));

const projectCoreEvent = (event: CoreControlEvent): CoreControlEvent => {
  if (event.type === "downloadState") {
    return { ...event, data: { ...event.data, track: mapTrack(event.data.track) } };
  }
  if (event.type === "session") {
    return { ...event, data: mapSession(event.data) };
  }
  if (event.type === "trackLoaded") {
    return {
      ...event,
      data: {
        ...event.data,
        track: mapTrack(event.data.track),
        mediaInfo: event.data.mediaInfo
          ? { ...event.data.mediaInfo, cover: controlAssetUrl(event.data.mediaInfo.cover) }
          : undefined,
      },
    };
  }
  return event;
};

const connectDesktop = (): (() => void) => {
  const coreEvents = (window.api as typeof window.api & { coreEvents: CoreEventsApi }).coreEvents;
  return coreEvents.onEvent((event) => emit(projectCoreEvent(event)));
};

const host = window.location.hostname || "127.0.0.1";
const dev = import.meta.env.DEV;
const wsOrigin = dev
  ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${host}:14559`
  : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;

const connectWeb = (): (() => void) => {
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
      emit(projectCoreEvent({ type: "session", data: session }));
      emit({ type: "status", data: status });
      emit({ type: "deviceChanged", data: { defaultDevice: null } });
    } catch {
      // 服务启动窗口或短暂断线由后续实时事件/重连继续恢复。
    }
  };

  /** 高频 position 不走 WS；Web 使用轻量 status snapshot 驱动进度。 */
  const syncStatus = async (): Promise<void> => {
    if (disposed || document.visibilityState !== "visible" || ws?.readyState !== WebSocket.OPEN)
      return;
    try {
      const status = await request<PlayerStatus>("/status");
      if (disposed || ws?.readyState !== WebSocket.OPEN) return;
      emit({ type: "status", data: status });
    } catch {
      // 下一轮 snapshot 或重连继续恢复。
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
      emit({ type: "coreCompatibilityError", data: { error: message } });
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
        if (payload.kind !== "event" || !payload.type) return;
        const event = { type: payload.type, data: payload.data } as ControlEvent;
        if (isCoreControlEvent(event)) {
          emit(projectCoreEvent(event));
          return;
        }
        emit(event);
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

const ensureTransport = (): void => {
  if (disconnectTransport) return;
  disconnectTransport =
    document.documentElement.dataset.atomRuntime === "desktop" ? connectDesktop() : connectWeb();
};

/** 订阅当前 Control transport 上的原始事件；Web player projection 也复用这一连接。 */
export const subscribeControlEvent = (listener: (event: ControlEvent) => void): (() => void) => {
  listeners.add(listener);
  ensureTransport();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      disconnectTransport?.();
      disconnectTransport = null;
    }
  };
};

/** 订阅一类已纳入统一契约的 Core Domain 事件。 */
export const subscribeCoreControlEvent = <T extends CoreEventType>(
  type: T,
  callback: (data: CoreEventOf<T>["data"]) => void,
): (() => void) =>
  subscribeControlEvent((event) => {
    if (event.type === type && event.data !== undefined) {
      callback(event.data as CoreEventOf<T>["data"]);
    }
  });

/** 订阅已从 Host directive/recovery event 中拆出的 Player projection。 */
export const subscribeCorePlayerProjection = (
  callback: (event: CorePlayerProjectionEvent) => void,
): (() => void) =>
  subscribeControlEvent((event) => {
    if (isCorePlayerProjectionEvent(event)) callback(event);
  });
