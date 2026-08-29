import { isManagedProviderPlatform, type ApiPlatform } from "@shared/types/apis";
import type { CoreInfo } from "@shared/types/core";
import type { CoreControlEvent } from "@shared/types/coreEvents";
import type { CommentSource, MusicCommentQuery, MusicCommentResponse } from "@shared/types/comment";
import type { ConfigApi, SystemConfig } from "@shared/types/settings";
import type { LibraryApi } from "@shared/types/library";
import type { PlaylistApi } from "@shared/types/playlist";
import type { LyricsApi, LyricTTMLResponse } from "@shared/types/lyrics";
import type { NowPlayingApi, NowPlayingSnapshot } from "@shared/types/nowPlaying";
import type { StatsApi } from "@shared/types/stats";
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
import { request, serverAssetUrl, webAssetUrl } from "./client";
import {
  isCoreControlEvent,
  isCorePlayerProjectionEvent,
  subscribeControlEvent,
} from "@/core/controlEventClient";
import { filterWebSystemOutputs } from "@/core/outputDevices";
import { providerClient } from "@/core/providerClient";
import { libraryClient } from "@/core/libraryClient";
import { downloadClient } from "@/core/downloadClient";

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

const configApi: ConfigApi = {
  get: async (keyPath) => {
    const all = await request<SystemConfig>("/config");
    let value: unknown = all;
    for (const key of keyPath.split(".")) {
      if (!value || typeof value !== "object") return undefined;
      value = (value as Record<string, unknown>)[key];
    }
    return value;
  },
  set: async (keyPath, value) => {
    await request("/config", { method: "POST", body: JSON.stringify({ keyPath, value }) });
  },
  getAll: () => request<SystemConfig>("/config"),
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
    asIpc(async () =>
      filterWebSystemOutputs((await request<OutputSnapshot>("/output/devices")).data),
    ),
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

const playlistApi: PlaylistApi = {
  list: async () =>
    (await request<Awaited<ReturnType<PlaylistApi["list"]>>>("/playlists")).map((item) => ({
      ...item,
      cover: webAssetUrl(item.cover),
    })),
  get: async (id) => {
    const detail = await request<Awaited<ReturnType<PlaylistApi["get"]>>>(
      `/playlists/${encodeURIComponent(id)}`,
    );
    return detail
      ? {
          ...detail,
          cover: webAssetUrl(detail.cover),
          tracks: detail.tracks.map(mapTrack),
        }
      : null;
  },
  create: (input) =>
    request<Awaited<ReturnType<PlaylistApi["create"]>>>("/playlists", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (id, input) =>
    request<Awaited<ReturnType<PlaylistApi["update"]>>>(`/playlists/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  remove: async (id) => {
    await request(`/playlists/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  addTracks: async (id, trackIds) =>
    (
      await request<{ count: number }>(`/playlists/${encodeURIComponent(id)}/tracks`, {
        method: "POST",
        body: JSON.stringify({ trackIds }),
      })
    ).count,
  removeTracks: async (id, trackIds) =>
    (
      await request<{ count: number }>(`/playlists/${encodeURIComponent(id)}/tracks`, {
        method: "DELETE",
        body: JSON.stringify({ trackIds }),
      })
    ).count,
  importLegacy: async (records) => {
    await request("/playlists/import-legacy", { method: "POST", body: JSON.stringify(records) });
  },
  clear: async () => {
    await request("/playlists", { method: "DELETE" });
  },
};

const nowPlayingApi: NowPlayingApi = {
  update: (payload) => {
    void request("/now-playing", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        track: payload.track ? toServerTrack(payload.track) : payload.track,
      }),
    });
  },
  requestSnapshot: async () => {
    const [light, lyric] = await Promise.all([
      request<Omit<NowPlayingSnapshot, "lyric" | "source"> & { track: Track | null }>(
        "/now-playing",
      ),
      request<{ lyric: NowPlayingSnapshot["lyric"]; source: NowPlayingSnapshot["source"] }>(
        "/lyrics",
      ),
    ]);
    return {
      ...light,
      track: light.track ? mapTrack(light.track) : null,
      lyric: lyric.lyric,
      source: lyric.source,
    } as NowPlayingSnapshot;
  },
  setLyricOffset: (trackId, offsetMs) => {
    void request("/now-playing/lyric-offset", {
      method: "POST",
      body: JSON.stringify({ trackId, offsetMs }),
    });
  },
  onTrackChange: (callback) =>
    subscribeEvent((event) => {
      if (event.type !== "session") return;
      const session = mapSession(event.data as PlaybackSessionSnapshot);
      callback({ track: session.current });
    }),
  onLyricChange: () => () => {},
  onPositionSync: () => () => {},
  onLyricOffsetChange: () => () => {},
};

const lyricsApi: Partial<LyricsApi> = {
  matchLocalTTML: (track): Promise<LyricTTMLResponse> =>
    request<LyricTTMLResponse>("/lyrics/local", {
      method: "POST",
      body: JSON.stringify({ track: toServerTrack(track) }),
    }),
};

const statsApi: StatsApi = {
  // Headless 播放统计由唯一主进程会话写入，避免多浏览器重复计数。
  recordPlay: () => {},
  recordFavorite: (event) => {
    void request("/stats/favorite", {
      method: "POST",
      body: JSON.stringify({ ...event, track: toServerTrack(event.track) }),
    });
  },
  getStatsSummary: () => request("/stats/summary"),
  getTopTracks: async (limit) =>
    (
      await request<Awaited<ReturnType<StatsApi["getTopTracks"]>>>(
        `/stats/top-tracks?limit=${limit}`,
      )
    ).map((item) => ({ ...item, track: mapTrack(item.track) })),
  getLibraryStats: () => request("/stats/library"),
  getPlayHistoryDaily: (days) => request(`/stats/daily?days=${days}`),
  getPlayHistoryHourly: () => request("/stats/hourly"),
  getTopAlbums: async (limit) =>
    (
      await request<Awaited<ReturnType<StatsApi["getTopAlbums"]>>>(
        `/stats/top-albums?limit=${limit}`,
      )
    ).map((item) => ({ ...item, track: mapTrack(item.track) })),
  getTopArtists: async (limit) =>
    (
      await request<Awaited<ReturnType<StatsApi["getTopArtists"]>>>(
        `/stats/top-artists?limit=${limit}`,
      )
    ).map((item) => ({ ...item, track: mapTrack(item.track) })),
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
    playlist: playlistApi,
    nowPlaying: nowPlayingApi,
    lyrics: lyricsApi,
    stats: statsApi,
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
      getStats: () => request("/cache/stats"),
      clear: async (id: string) => {
        await request("/cache/clear", { method: "POST", body: JSON.stringify({ id }) });
      },
      clearAllByKind: async (kind: "file" | "db") => {
        await request("/cache/clear-all", { method: "POST", body: JSON.stringify({ kind }) });
      },
      getDir: async () => (await request<{ dir: string }>("/cache/dir")).dir,
      pickDir: async () => {
        throw new Error("Web Control does not provide a Core filesystem picker");
      },
      resetDir: async () =>
        (await request<{ dir: string }>("/cache/reset-dir", { method: "POST" })).dir,
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
    comments: {
      sources: () => request<CommentSource[]>("/comments/sources"),
      get: (args: MusicCommentQuery) =>
        request<MusicCommentResponse>("/comments/music", {
          method: "POST",
          body: JSON.stringify({ ...args, track: toServerTrack(args.track) }),
        }).catch((error) => ({ ok: false as const, error: errorText(error) })),
    },
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
};
