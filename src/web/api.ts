import { isManagedProviderPlatform, type ApiPlatform } from "@shared/types/apis";
import type { CoreInfo } from "@shared/types/core";
import type { CoreControlEvent } from "@shared/types/coreEvents";
import { isCoreOwnedSettingPath, type ConfigApi, type SystemConfig } from "@shared/types/settings";
import type { LibraryApi } from "@shared/types/library";
import type { LyricsApi } from "@shared/types/lyrics";
import type { NowPlayingApi } from "@shared/types/nowPlaying";
import type {
  AudioDevice,
  IpcResponse,
  LoadResult,
  PlaybackQueueItem,
  PlaybackSessionSnapshot,
  PlayerApi,
  PlayerEvent,
  PlayerStatus,
  Track,
} from "@shared/types/player";
import { defaultSystemConfig } from "@shared/defaults/settings";
import { getByPath, setByPath } from "@shared/utils/path";
import { request, serverAssetUrl, webAssetUrl } from "./client";
import {
  isCoreControlEvent,
  isCorePlayerProjectionEvent,
  subscribeControlEvent,
  subscribeCoreControlEvent,
} from "@/core/controlEventClient";
import { filterWebSystemOutputs } from "@/core/outputDevices";
import { providerClient } from "@/core/providerClient";
import { libraryClient } from "@/core/libraryClient";
import { downloadClient } from "@/core/downloadClient";
import { playlistClient } from "@/core/playlistClient";
import { statsClient } from "@/core/statsClient";
import { cacheClient } from "@/core/cacheClient";
import { nowPlayingClient } from "@/core/nowPlayingClient";
import { pluginClient } from "@/core/pluginClient";
import { commentsClient } from "@/core/commentsClient";
import { lyricsClient } from "@/core/lyricsClient";

interface OutputSnapshot {
  selected: string | null;
  data: AudioDevice[];
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const noopSubscription = (): (() => void) => () => {};

const asIpc = async <T>(loader: () => Promise<T>): Promise<IpcResponse<T>> => {
  try {
    return { success: true, data: await loader() };
  } catch (error) {
    return { success: false, error: errorText(error) };
  }
};

const asCommand = async (loader: () => Promise<unknown>): Promise<IpcResponse> => {
  try {
    await loader();
    return { success: true };
  } catch (error) {
    return { success: false, error: errorText(error) };
  }
};

const mapTrack = (track: Track): Track => ({
  ...track,
  cover: webAssetUrl(track.cover),
  coverOriginal: webAssetUrl(track.coverOriginal),
});

/** Headless 主进程只持久化 cache:// 规范 URL，不保留某个浏览器的主机地址。 */
const toServerTrack = (track: Track): Track => ({
  ...track,
  cover: serverAssetUrl(track.cover),
  coverOriginal: serverAssetUrl(track.coverOriginal),
});

const toServerQueueItem = (item: PlaybackQueueItem): PlaybackQueueItem => ({
  ...item,
  track: toServerTrack(item.track),
});

const mapQueueItem = (item: PlaybackQueueItem): PlaybackQueueItem => ({
  ...item,
  track: mapTrack(item.track),
});

const mapSession = (session: PlaybackSessionSnapshot): PlaybackSessionSnapshot => ({
  ...session,
  queue: session.queue.map(mapQueueItem),
  originalQueue: session.originalQueue?.map(mapQueueItem) ?? null,
  current: session.current ? mapTrack(session.current) : null,
});

const subscribeEvent = subscribeControlEvent;

const sessionResponse = (loader: () => Promise<PlaybackSessionSnapshot>) =>
  asIpc(async () => mapSession(await loader()));

const WEB_CONTROL_CONFIG_KEY = "splayer/web-control-system";
const WEB_CONTROL_SETTING_PATHS = new Set([
  "system.onboardingCompleted",
  "system.agreedAgreementVersion",
  "system.uiZoom",
]);

/** Web 仅持久化明确属于 This Control 的兼容 SystemConfig 字段。 */
const assertWebControlSettingPath = (keyPath: string): void => {
  if (isCoreOwnedSettingPath(keyPath)) {
    throw new Error(`Core setting must use Core Protocol: ${keyPath}`);
  }
  if (!WEB_CONTROL_SETTING_PATHS.has(keyPath)) {
    throw new Error(`Setting is not owned by Web Control: ${keyPath}`);
  }
};

/** Web 仅持久化 This Control 路径；Core-owned 设置永远来自 Core snapshot。 */
const loadWebControlEntries = (): Record<string, unknown> => {
  try {
    const raw = localStorage.getItem(WEB_CONTROL_CONFIG_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const applyWebControlEntry = (keyPath: string, value: unknown): void => {
  if (keyPath === "system.uiZoom" && typeof value === "number" && Number.isFinite(value)) {
    const percent = Math.max(50, Math.min(200, value));
    document.documentElement.style.setProperty("zoom", `${percent}%`);
  }
};

const saveWebControlEntry = (keyPath: string, value: unknown): void => {
  assertWebControlSettingPath(keyPath);
  const entries = loadWebControlEntries();
  entries[keyPath] = value;
  localStorage.setItem(WEB_CONTROL_CONFIG_KEY, JSON.stringify(entries));
  applyWebControlEntry(keyPath, value);
};

const getWebControlConfig = (): SystemConfig => {
  const config = structuredClone(defaultSystemConfig);
  for (const [keyPath, value] of Object.entries(loadWebControlEntries())) {
    if (WEB_CONTROL_SETTING_PATHS.has(keyPath)) setByPath(config, keyPath, value);
  }
  return config;
};

const configApi: ConfigApi = {
  get: async (keyPath) => {
    assertWebControlSettingPath(keyPath);
    return getByPath(getWebControlConfig(), keyPath);
  },
  set: async (keyPath, value) => saveWebControlEntry(keyPath, value),
  getAll: async () => getWebControlConfig(),
  reset: async () => {
    throw new Error("Web runtime does not expose configuration reset");
  },
  replaceAll: async () => {
    throw new Error("Web runtime does not expose configuration import");
  },
  exportToFile: async () => ({ ok: false, reason: "writeFailed" }),
  importFromFile: async () => ({ ok: false, reason: "readFailed" }),
};

const playerApi: PlayerApi = {
  load: async (source, options) => {
    try {
      const result = await request<IpcResponse<LoadResult>>("/player/load", {
        method: "POST",
        body: JSON.stringify({
          source,
          options: options?.meta ? { ...options, meta: toServerTrack(options.meta) } : options,
        }),
      });
      if (result.success && result.data?.mediaInfo.cover) {
        result.data.mediaInfo.cover = webAssetUrl(result.data.mediaInfo.cover);
      }
      return result;
    } catch (error) {
      return { success: false, error: errorText(error) };
    }
  },
  play: () => asCommand(() => request("/play", { method: "POST" })),
  pause: () => asCommand(() => request("/pause", { method: "POST" })),
  stop: () => asCommand(() => request("/stop", { method: "POST" })),
  seek: (positionMs) =>
    asCommand(() => request("/seek", { method: "POST", body: JSON.stringify({ positionMs }) })),
  getSession: () => sessionResponse(() => request<PlaybackSessionSnapshot>("/session")),
  reloadSessionCurrent: (forcePlay) =>
    asIpc(
      async () =>
        (
          await request<{ reloaded: boolean }>("/session/reload", {
            method: "POST",
            body: JSON.stringify({ forcePlay }),
          })
        ).reloaded,
    ),
  migrateLegacySessionQueue: () =>
    sessionResponse(() => request<PlaybackSessionSnapshot>("/session")),
  replaceSessionQueue: (items, startIndex = 0, autoPlay = true, loadCurrent = true) =>
    sessionResponse(() =>
      request<PlaybackSessionSnapshot>("/session/queue", {
        method: "POST",
        body: JSON.stringify({
          items: items.map(toServerQueueItem),
          startIndex,
          autoPlay,
          loadCurrent,
        }),
      }),
    ),
  appendSessionQueue: (items) =>
    sessionResponse(() =>
      request<PlaybackSessionSnapshot>("/session/queue/append", {
        method: "POST",
        body: JSON.stringify({ items: items.map(toServerQueueItem) }),
      }),
    ),
  insertSessionQueue: (items, index) =>
    sessionResponse(() =>
      request<PlaybackSessionSnapshot>("/session/queue/insert", {
        method: "POST",
        body: JSON.stringify({ items: items.map(toServerQueueItem), index }),
      }),
    ),
  removeSessionQueueIndex: (index, loadCurrent = true) =>
    sessionResponse(() =>
      request<PlaybackSessionSnapshot>(
        `/session/queue/${index}?loadCurrent=${loadCurrent ? "1" : "0"}`,
        {
          method: "DELETE",
        },
      ),
    ),
  selectSessionIndex: (index, loadCurrent = true, autoPlay = true) =>
    sessionResponse(() =>
      request<PlaybackSessionSnapshot>("/session/queue/select", {
        method: "POST",
        body: JSON.stringify({ index, loadCurrent, autoPlay }),
      }),
    ),
  nextSession: (loadCurrent = true) =>
    sessionResponse(() =>
      request<PlaybackSessionSnapshot>("/session/next", {
        method: "POST",
        body: JSON.stringify({ loadCurrent }),
      }),
    ),
  prevSession: (loadCurrent = true) =>
    sessionResponse(() =>
      request<PlaybackSessionSnapshot>("/session/prev", {
        method: "POST",
        body: JSON.stringify({ loadCurrent }),
      }),
    ),
  updateSessionQueueItem: (index, item) =>
    sessionResponse(() =>
      request<PlaybackSessionSnapshot>(`/session/queue/${index}`, {
        method: "PATCH",
        body: JSON.stringify({ item: toServerQueueItem(item) }),
      }),
    ),
  moveSessionQueue: (fromIndex, toIndex) =>
    sessionResponse(() =>
      request<PlaybackSessionSnapshot>("/session/queue/move", {
        method: "POST",
        body: JSON.stringify({ fromIndex, toIndex }),
      }),
    ),
  removeSessionServerTracks: (serverId) =>
    sessionResponse(() =>
      request<PlaybackSessionSnapshot>(`/session/server/${encodeURIComponent(serverId)}`, {
        method: "DELETE",
      }),
    ),
  updateSessionQueueTracks: (tracks) =>
    sessionResponse(() =>
      request<PlaybackSessionSnapshot>("/session/queue/tracks", {
        method: "PATCH",
        body: JSON.stringify({ tracks: tracks.map(toServerTrack) }),
      }),
    ),
  clearSessionQueue: (stop = false) =>
    sessionResponse(() =>
      request<PlaybackSessionSnapshot>("/session/queue/clear", {
        method: "POST",
        body: JSON.stringify({ stop }),
      }),
    ),
  setSessionRepeat: (mode) =>
    sessionResponse(() =>
      request<PlaybackSessionSnapshot>("/session/repeat", {
        method: "POST",
        body: JSON.stringify({ mode }),
      }),
    ),
  setSessionShuffle: (mode) =>
    sessionResponse(() =>
      request<PlaybackSessionSnapshot>("/session/shuffle", {
        method: "POST",
        body: JSON.stringify({ mode }),
      }),
    ),
  startPersonalFm: (options, autoPlay = true) =>
    sessionResponse(() =>
      request<PlaybackSessionSnapshot>("/session/personal-fm", {
        method: "POST",
        body: JSON.stringify({ options, autoPlay }),
      }),
    ),
  dislikePersonalFm: (playedSec) =>
    sessionResponse(() =>
      request<PlaybackSessionSnapshot>("/session/personal-fm/dislike", {
        method: "POST",
        body: JSON.stringify({ playedSec }),
      }),
    ),
  setSessionAutoClose: (durationMin, waitSongEnd) =>
    sessionResponse(() =>
      request<PlaybackSessionSnapshot>("/session/auto-close", {
        method: "POST",
        body: JSON.stringify({ durationMin, waitSongEnd }),
      }),
    ),
  cancelSessionAutoClose: () =>
    sessionResponse(() =>
      request<PlaybackSessionSnapshot>("/session/auto-close", { method: "DELETE" }),
    ),
  setVolume: (volume) =>
    asCommand(() => request("/volume", { method: "POST", body: JSON.stringify({ volume }) })),
  setPauseOnDeviceSwitch: async () => ({ success: true }),
  getVolume: () => asIpc(async () => (await request<{ volume: number }>("/volume")).volume),
  getStatus: () => asIpc(() => request<PlayerStatus>("/status")),
  setFftEnabled: (enabled) =>
    asCommand(() => request("/player/fft", { method: "POST", body: JSON.stringify({ enabled }) })),
  getFftData: () =>
    asIpc(
      async () =>
        (await request<{ data: { ldata: number[]; rdata: number[] } }>("/player/fft")).data,
    ),
  setFadeDuration: (durationMs) =>
    asCommand(() =>
      request("/player/fade", { method: "POST", body: JSON.stringify({ durationMs }) }),
    ),
  getFadeDuration: () => asIpc(async () => (await request<{ data: number }>("/player/fade")).data),
  getCoverRaw: () =>
    asIpc(async () => (await request<{ data: string | null }>("/player/cover")).data),
  readLyricFile: (path) =>
    asIpc(
      async () =>
        (
          await request<{ data: string }>("/player/read-lyric", {
            method: "POST",
            body: JSON.stringify({ path }),
          })
        ).data,
    ),
  reinit: () => asCommand(() => request("/player/reinit", { method: "POST" })),
  setNormalizationEnabled: (enabled) =>
    asCommand(() =>
      request("/player/normalization", { method: "POST", body: JSON.stringify({ enabled }) }),
    ),
  setEqualizerEnabled: (enabled) =>
    asCommand(() =>
      request("/player/equalizer", { method: "POST", body: JSON.stringify({ enabled }) }),
    ),
  setEqualizerBands: (bands) =>
    asCommand(() =>
      request("/player/equalizer", { method: "POST", body: JSON.stringify({ bands }) }),
    ),
  setPreampGain: (preamp) =>
    asCommand(() =>
      request("/player/equalizer", { method: "POST", body: JSON.stringify({ preamp }) }),
    ),
  setSpeed: (speed) =>
    asCommand(() => request("/player/speed", { method: "POST", body: JSON.stringify({ speed }) })),
  setPitch: (semitones) =>
    asCommand(() =>
      request("/player/pitch", { method: "POST", body: JSON.stringify({ semitones }) }),
    ),
  setPitchSync: (enabled) =>
    asCommand(() =>
      request("/player/pitch-sync", { method: "POST", body: JSON.stringify({ enabled }) }),
    ),
  getOutputDevices: () =>
    asIpc(async () => {
      const snapshot = await request<OutputSnapshot>("/output/devices");
      return filterWebSystemOutputs(snapshot.data, snapshot.selected);
    }),
  scanDirettaDevices: () =>
    asIpc(async () =>
      (await request<OutputSnapshot>("/output/devices")).data
        .filter((device) => device.id.startsWith("diretta:"))
        .map((device) => ({ ...device, name: `${device.name} · Diretta` })),
    ),
  getDefaultDeviceName: () =>
    asIpc(
      async () =>
        (await request<OutputSnapshot>("/output/devices")).data.find((device) => device.isDefault)
          ?.name ?? null,
    ),
  setOutputDevice: (deviceId) =>
    asCommand(() =>
      request("/output/select", { method: "POST", body: JSON.stringify({ deviceId }) }),
    ),
  getSelectedDeviceName: () =>
    asIpc(async () => (await request<OutputSnapshot>("/output/devices")).selected),
  syncPlayMode: () => {},
  syncLikeState: () => {},
  dispatch: () => {},
  onEvent: (callback) =>
    subscribeEvent((event) => {
      if (isCoreControlEvent(event) && !isCorePlayerProjectionEvent(event)) return;
      if (event.type === "session") {
        callback({ type: "session", data: mapSession(event.data as PlaybackSessionSnapshot) });
        return;
      }
      callback(event as PlayerEvent);
    }),
};

const libraryApi: LibraryApi = {
  ...libraryClient,
  pickScanDir: async () => ({ success: false, error: "WEB_FILE_PICKER_UNSUPPORTED" }),
  pickCoverImage: async () => ({ success: false, error: "WEB_FILE_PICKER_UNSUPPORTED" }),
};

const nowPlayingApi: NowPlayingApi = {
  update: (payload) => {
    void request("/now-playing", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  requestSnapshot: nowPlayingClient.requestSnapshot,
  setLyricOffset: nowPlayingClient.setLyricOffset,
  onTrackChange: (callback) =>
    subscribeEvent((event) => {
      if (event.type !== "session") return;
      const session = mapSession(event.data as PlaybackSessionSnapshot);
      callback({ track: session.current });
    }),
  onLyricChange: () => () => {},
  onPositionSync: () => () => {},
  onLyricOffsetChange: (callback) => subscribeCoreControlEvent("lyricOffset", callback),
};

const lyricsApi: LyricsApi = {
  ...lyricsClient,
  pickLyricRepoDir: async () => null,
};

/** 安装远程浏览器使用的最小 Electron API 兼容面。 */
export const installWebApi = async (): Promise<void> => {
  const info = await request<CoreInfo>("/info");
  const api = {
    coreEvents: {
      onEvent: (callback: (event: CoreControlEvent) => void) =>
        subscribeControlEvent((event) => {
          if (isCoreControlEvent(event)) callback(event);
        }),
    },
    config: configApi,
    player: playerApi,
    library: libraryApi,
    playlist: playlistClient,
    nowPlaying: nowPlayingApi,
    lyrics: lyricsApi,
    stats: statsClient,
    system: {
      installType: "portable" as const,
      platform: info.platform,
      osInfo: { type: info.platform, arch: info.arch, release: "" },
      toggleDevTools: () => window.open("/debug", "_blank", "noopener,noreferrer"),
      showInExplorer: async () => {
        window.alert("Web 远程模式无法在主机文件管理器中显示文件。");
        return false;
      },
      openLogsDir: async () => false,
      setLocale: () => {},
      focusMainWindow: async () => window.focus(),
      openSettings: async () => {},
      onOpenSettings: () => noopSubscription(),
      listFonts: async () => [],
      fetchRemoteBytes: async (url: string) => (await fetch(url)).arrayBuffer(),
      saveFile: async () => {
        throw new Error("Web runtime does not expose host file saving");
      },
      relaunch: async () => window.location.reload(),
      testNetworkProxy: async () =>
        (await request<{ ok: boolean }>("/system/network-proxy/test", { method: "POST" })).ok,
      onProtocolUrl: () => noopSubscription(),
      consumePendingProtocolUrl: async () => null,
    },
    window: {
      toggleDesktopLyric: async () => false,
      closeDesktopLyric: async () => {},
      isDesktopLyricOpen: async () => false,
      onDesktopLyricVisibilityChange: () => noopSubscription(),
      toggleDynamicIsland: async () => false,
      closeDynamicIsland: async () => {},
      isDynamicIslandOpen: async () => false,
      onDynamicIslandVisibilityChange: () => noopSubscription(),
      toggleTaskbarLyric: async () => false,
      closeTaskbarLyric: async () => {},
      isTaskbarLyricOpen: async () => false,
      onTaskbarLyricVisibilityChange: () => noopSubscription(),
      minimize: () => {},
      toggleMaximize: () => {},
      isMaximized: async () => false,
      onMaximizeChange: () => noopSubscription(),
      toggleFullscreen: () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      },
      isFullscreen: async () => document.fullscreenElement !== null,
      onFullscreenChange: (callback: (fullscreen: boolean) => void) => {
        const handler = (): void => callback(document.fullscreenElement !== null);
        document.addEventListener("fullscreenchange", handler);
        return () => document.removeEventListener("fullscreenchange", handler);
      },
      hide: () => {},
      quit: () => {},
    },
    desktopLyric: {
      onConfigChange: () => noopSubscription(),
      setHeight: async () => {},
      setUnlockButtonBounds: () => {},
      move: () => {},
      saveState: () => {},
      onCursorInside: () => noopSubscription(),
    },
    dynamicIsland: {
      onConfigChange: () => noopSubscription(),
      move: () => {},
      saveState: () => {},
      resize: () => {},
      setShape: () => {},
      setHeight: () => {},
      getMode: async () => "snapped" as const,
      onModeChange: () => noopSubscription(),
      onCursorInside: () => noopSubscription(),
    },
    taskbarLyric: {
      setContentWidth: () => {},
      onLayout: () => noopSubscription(),
      onConfigChange: () => noopSubscription(),
    },
    update: {
      check: async () => {},
      download: async () => {},
      install: async () => {},
      openDownloadPage: async () => {},
      onEvent: () => noopSubscription(),
    },
    cache: {
      ...cacheClient,
      pickDir: async () => {
        throw new Error("Web Control does not provide a Core filesystem picker");
      },
      song: {
        lookup: async () => {
          throw new Error("Core owns song-cache lookup in Web Control");
        },
        fetch: async () => {
          throw new Error("Core owns song-cache scheduling in Web Control");
        },
        cancel: async () => {
          throw new Error("Core owns song-cache cancellation in Web Control");
        },
      },
    },
    plugins: {
      ...pluginClient,
      install: async () => ({
        ok: false,
        error: "Web Control cannot install a Core plugin by host path",
      }),
      pickAndInstall: async () => ({ ok: false, cancelled: true }),
    },
    comments: commentsClient,
    download: {
      ...downloadClient,
      pickDir: async () => {
        throw new Error("Web Control uses the shared Core directory browser");
      },
    },
    apis: {
      call: async (platform: ApiPlatform, name: string, params?: Record<string, unknown>) => {
        if (!isManagedProviderPlatform(platform)) {
          return { ok: false as const, error: "WEB_PROVIDER_UNSUPPORTED" };
        }
        try {
          return await providerClient.call(platform, name, params);
        } catch (error) {
          return { ok: false as const, error: errorText(error) };
        }
      },
      openLoginWeb: async () => ({ ok: false as const, error: "WEB_PROVIDER_LOGIN_UNSUPPORTED" }),
    },
  };
  window.api = api as unknown as Window["api"];
  for (const [keyPath, value] of Object.entries(loadWebControlEntries())) {
    if (WEB_CONTROL_SETTING_PATHS.has(keyPath)) applyWebControlEntry(keyPath, value);
  }
};
