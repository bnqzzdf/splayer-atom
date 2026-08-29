import type { ApiCallResponse, ApiPlatform, ProviderSessionsSnapshot } from "@shared/types/apis";
import type { ConfigApi, SystemConfig } from "@shared/types/settings";
import type { LibraryApi, AlbumSummary, ArtistSummary } from "@shared/types/library";
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
import { connectWebEvents, request, serverAssetUrl, webAssetUrl } from "./client";

interface OutputSnapshot {
  selected: string | null;
  data: AudioDevice[];
}

interface WebEvent {
  type: string;
  data?: unknown;
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const noopSubscription = (): (() => void) => () => {};
const WEB_PROVIDER_PLATFORMS = new Set<ApiPlatform>(["netease", "qqmusic", "kugou"]);

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

/** Linux Web 只展示系统默认、真实 ALSA hw 声卡；插件/转换/重复数字别名不暴露给用户。 */
const filterSystemOutputs = (devices: AudioDevice[]): AudioDevice[] => {
  const seen = new Set<string>();
  return devices.filter((device) => {
    if (device.id.startsWith("diretta:")) return false;
    if (
      device.id.startsWith("alsa:") &&
      !device.isDefault &&
      !/^alsa:hw:CARD=[A-Za-z_][^,]*,DEV=\d+$/.test(device.id)
    ) {
      return false;
    }
    const key = device.isDefault ? `default:${device.id}` : device.name.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

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

const mapAlbum = (album: AlbumSummary): AlbumSummary => ({
  ...album,
  cover: webAssetUrl(album.cover),
});

const mapArtist = (artist: ArtistSummary): ArtistSummary => ({
  ...artist,
  cover: webAssetUrl(artist.cover),
});

const eventListeners = new Set<(event: WebEvent) => void>();
let disconnectEvents: (() => void) | null = null;
/** Web 扫描请求代次，用于识别快于轮询周期完成的扫描。 */
let scanRequestGeneration = 0;

const ensureEventConnection = (): void => {
  if (disconnectEvents) return;
  disconnectEvents = connectWebEvents((event) => {
    for (const listener of eventListeners) listener(event);
  });
};

const subscribeEvent = (listener: (event: WebEvent) => void): (() => void) => {
  eventListeners.add(listener);
  ensureEventConnection();
  return () => {
    eventListeners.delete(listener);
    if (eventListeners.size === 0) {
      disconnectEvents?.();
      disconnectEvents = null;
    }
  };
};

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
  stageDirectNext: async () => ({ success: true, data: { staged: false } }),
  cancelDirectNext: async () => ({ success: true }),
  commitDirectGaplessBoundary: async () => ({
    success: false,
    error: "WEB_DIRECT_STAGING_DISABLED",
  }),
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
  reinit: async () => ({ success: false, error: "WEB_REINIT_UNSUPPORTED" }),
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
    asIpc(async () => filterSystemOutputs((await request<OutputSnapshot>("/output/devices")).data)),
  scanDirettaDevices: () =>
    asIpc(async () =>
      (await request<OutputSnapshot>("/output/devices")).data
        .filter((device) => device.id.startsWith("diretta:"))
        .map((device) => ({ ...device, name: `${device.name} · Diretta` })),
    ),
  materializeDirectInput: (source) =>
    asIpc(
      async () =>
        (
          await request<{ path: string }>("/player/direct-input/materialize", {
            method: "POST",
            body: JSON.stringify({ source }),
          })
        ).path,
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
      if (event.type === "libraryScanProgress") return;
      if (event.type === "session") {
        callback({ type: "session", data: mapSession(event.data as PlaybackSessionSnapshot) });
        return;
      }
      callback(event as PlayerEvent);
    }),
};

const libraryApi: LibraryApi = {
  scan: async (incremental = true) => {
    const result = await asCommand(() =>
      request("/library/scan", { method: "POST", body: JSON.stringify({ incremental }) }),
    );
    if (result.success) scanRequestGeneration++;
    return result;
  },
  cancelScan: () => asCommand(() => request("/library/scan/cancel", { method: "POST" })),
  getTracks: () =>
    asIpc(async () => (await request<{ data: Track[] }>("/library/tracks")).data.map(mapTrack)),
  getAlbums: () =>
    asIpc(async () =>
      (await request<{ data: AlbumSummary[] }>("/library/albums")).data.map(mapAlbum),
    ),
  getArtists: () =>
    asIpc(async () =>
      (await request<{ data: ArtistSummary[] }>("/library/artists")).data.map(mapArtist),
    ),
  getAlbumTracks: (albumName) =>
    asIpc(async () =>
      (
        await request<{ data: Track[] }>(`/library/albums/${encodeURIComponent(albumName)}/tracks`)
      ).data.map(mapTrack),
    ),
  getArtistTracks: (artistName) =>
    asIpc(async () =>
      (
        await request<{ data: Track[] }>(
          `/library/artists/${encodeURIComponent(artistName)}/tracks`,
        )
      ).data.map(mapTrack),
    ),
  getTracksByIds: (ids) =>
    asIpc(async () =>
      (
        await request<{ data: Track[] }>(
          `/library/tracks/by-ids?ids=${encodeURIComponent(ids.join(","))}`,
        )
      ).data.map(mapTrack),
    ),
  searchTracks: (query) =>
    asIpc(async () =>
      (
        await request<{ data: Track[] }>(
          `/library/search?type=songs&q=${encodeURIComponent(query)}&limit=500`,
        )
      ).data.map(mapTrack),
    ),
  getTrackCount: () => asIpc(async () => (await request<{ data: number }>("/library/count")).data),
  getRandomTrack: () =>
    asIpc(async () => {
      const track = (await request<{ data: Track | null }>("/library/random-one")).data;
      return track ? mapTrack(track) : null;
    }),
  getRandomTracks: (limit) =>
    asIpc(async () =>
      (await request<{ data: Track[] }>(`/library/random?limit=${limit}`)).data.map(mapTrack),
    ),
  isScanning: () =>
    asIpc(async () => (await request<{ data: boolean }>("/library/is-scanning")).data),
  addScanDir: () => {
    const dir = window.prompt("请输入主机上的音乐目录路径", "/media/music")?.trim();
    if (!dir) return Promise.resolve({ success: false, error: "SCAN_DIR_NOT_SELECTED" });
    return request<IpcResponse<string>>("/library/scan-dirs/add", {
      method: "POST",
      body: JSON.stringify({ dir }),
    }).catch((error) => ({ success: false, error: errorText(error) }));
  },
  removeScanDir: (dir) =>
    asCommand(() =>
      request("/library/scan-dirs", { method: "DELETE", body: JSON.stringify({ dir }) }),
    ),
  getScanDirs: () =>
    asIpc(async () => (await request<{ data: string[] }>("/library/scan-dirs")).data),
  deleteTracks: async (paths) => ({
    success: false,
    error: `Web 文件删除尚未开放 (${paths.length})`,
  }),
  readTags: async () => ({ success: false, error: "WEB_TAG_EDIT_UNSUPPORTED" }),
  writeTags: async () => ({ success: false, error: "WEB_TAG_EDIT_UNSUPPORTED" }),
  pickCoverImage: async () => ({ success: false, error: "WEB_FILE_PICKER_UNSUPPORTED" }),
  fetchArtistAvatar: (artistName) =>
    request<IpcResponse<string | null>>(
      `/library/artists/${encodeURIComponent(artistName)}/avatar`,
    ).then((result) => ({
      ...result,
      data: result.data ? webAssetUrl(result.data) : result.data,
    })),
  prefetchArtistAvatars: (artistNames) =>
    request<IpcResponse<Record<string, string>>>("/library/artists/avatars", {
      method: "POST",
      body: JSON.stringify({ names: artistNames }),
    }).then((result) => ({
      ...result,
      data: result.data
        ? Object.fromEntries(
            Object.entries(result.data).map(([key, value]) => [key, webAssetUrl(value) ?? value]),
          )
        : result.data,
    })),
  onScanProgress: (callback) => {
    let disposed = false;
    let seenScanning = false;
    let observedGeneration = scanRequestGeneration;
    const poll = async (): Promise<void> => {
      if (disposed || document.visibilityState !== "visible") return;
      try {
        const scanning = (await request<{ data: boolean }>("/library/is-scanning")).data;
        const requestCompleted = observedGeneration !== scanRequestGeneration;
        observedGeneration = scanRequestGeneration;
        if (scanning) {
          seenScanning = true;
          callback({ phase: "scanning", total: 0, scanned: 0 });
        } else if (seenScanning || requestCompleted) {
          // 增量扫描可能在一次轮询间隔内完成，仍需显式结束 renderer 的 scanning 状态。
          seenScanning = false;
          callback({ phase: "done", total: 0, scanned: 0 });
        }
      } catch {
        // 下一轮轮询继续恢复；HTTP snapshot 仍是权威。
      }
    };
    const timer = window.setInterval(() => void poll(), 250);
    void poll();
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  },
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
  const info = await request<{ platform: NodeJS.Platform }>("/info");
  const api = {
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
      osInfo: { type: "", arch: "", release: "" },
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
      testNetworkProxy: async () => ({ success: false, error: "WEB_NETWORK_PROXY_UNSUPPORTED" }),
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
    comments: {
      sources: async () => [],
      get: async () => ({ comments: [], total: 0, hasMore: false }),
    },
    download: {
      list: async () => [],
      onProgress: () => noopSubscription(),
      onState: () => noopSubscription(),
      onResolve: () => noopSubscription(),
      cancel: async () => {},
      remove: async () => {},
      clearFinished: async () => {},
      submitResolution: async () => {},
      failResolution: async () => {},
    },
    apis: {
      call: async (platform: ApiPlatform, name: string, params?: Record<string, unknown>) => {
        if (!WEB_PROVIDER_PLATFORMS.has(platform)) {
          return { ok: false as const, error: "WEB_PROVIDER_UNSUPPORTED" };
        }
        try {
          return await request<ApiCallResponse>("/providers/call", {
            method: "POST",
            body: JSON.stringify({ platform, name, params }),
          });
        } catch (error) {
          return { ok: false as const, error: errorText(error) };
        }
      },
      clearSession: async (platform: ApiPlatform) => {
        if (!WEB_PROVIDER_PLATFORMS.has(platform)) return;
        await request("/providers/clear-session", {
          method: "POST",
          body: JSON.stringify({ platform }),
        });
      },
      getSessions: () => request<ProviderSessionsSnapshot>("/providers/sessions"),
      onSessionsChange: (callback: (snapshot: ProviderSessionsSnapshot) => void) =>
        subscribeEvent((event) => {
          if (event.type === "providerSessions" && event.data) {
            callback(event.data as ProviderSessionsSnapshot);
          }
        }),
      openLoginWeb: async () => ({ ok: false as const, error: "WEB_PROVIDER_LOGIN_UNSUPPORTED" }),
      setCookie: async (platform: ApiPlatform, cookie: string) => {
        if (!WEB_PROVIDER_PLATFORMS.has(platform)) {
          return { ok: false as const, error: "WEB_PROVIDER_LOGIN_UNSUPPORTED" };
        }
        try {
          return await request<{ ok: true } | { ok: false; error: string }>(
            "/providers/set-cookie",
            {
              method: "POST",
              body: JSON.stringify({ platform, cookie }),
            },
          );
        } catch (error) {
          return { ok: false as const, error: errorText(error) };
        }
      },
    },
  };
  window.api = api as unknown as Window["api"];
};
