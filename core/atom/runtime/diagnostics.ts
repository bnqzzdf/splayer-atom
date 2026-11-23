import os from "node:os";
import { MANAGED_PROVIDER_PLATFORMS } from "@shared/types/apis";
import type { ManagedProviderPlatform, ProviderSessionsSnapshot } from "@shared/types/apis";
import type { CacheStat } from "@shared/types/cache";
import type {
  CoreDiagnosticLogEntry,
  CoreDiagnosticsSnapshot,
  CoreInfo,
  CoreLogLevelSnapshot,
} from "@shared/types/core";
import type { ListenBrainzStatus } from "@shared/types/listenbrainz";
import type { AudioDevice, PlaybackSessionSnapshot, PlayerStatus } from "@shared/types/player";
import type { PluginInfo } from "@shared/types/plugin";
import type { AlsaPlaybackMode } from "@shared/types/settings";
import type { LibraryStats } from "@shared/types/stats";
import type { StreamingConfigSnapshot } from "@shared/types/streaming";
import { getCoreInfo, getCoreRuntimeBuildDetails } from "@main/atom/runtime/coreInfo";
import {
  getCachedUpnpRenderers,
  getSelectedUpnpOutput,
  getUpnpOutputStatus,
  type UpnpOutputStatus,
} from "@main/atom/upnp/output";
import { getDb, getLibraryStats, isDbOpen } from "@main/database";
import { getAlsaPlaybackMode } from "@main/services/alsaPlaybackMode";
import { getCacheStats } from "@main/services/cache";
import { getListenBrainzStatus } from "@main/services/listenbrainz";
import {
  getOutputDevices,
  getPlaybackSession,
  getPlaybackStatus,
  getSelectedOutputDevice,
} from "@main/services/playbackSession";
import { listPlugins } from "@main/services/pluginControl";
import { getProviderSessions } from "@main/services/providerApi";
import { streamingControl } from "@main/services/streaming/control";
import { getLogLevelSnapshot, getRecentLogs, redactDiagnosticText } from "@main/utils/logger";

export interface DiagnosticsSnapshotSources {
  generatedAt: string;
  uptimeSec: number;
  logLevel: CoreLogLevelSnapshot;
  coreInfo: CoreInfo;
  buildDetails: {
    buildDate: string | null;
    nodeBundled: boolean | null;
    bunBundled: boolean | null;
    packaged: boolean;
  };
  osRelease: string;
  memory: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
  };
  selectedDeviceId: string | null;
  alsaPlaybackMode: AlsaPlaybackMode;
  playbackStatus: PlayerStatus;
  playbackSession: PlaybackSessionSnapshot;
  localDevices: AudioDevice[];
  cachedUpnpRenderers: CoreDiagnosticsSnapshot["output"]["cachedUpnpRenderers"];
  selectedUpnpDeviceId: string | null;
  upnpStatus: UpnpOutputStatus;
  databaseOpen: boolean;
  schemaVersion: number | null;
  libraryStats: LibraryStats | null;
  cacheStats: CacheStat[];
  providerSessions: ProviderSessionsSnapshot;
  streamingConfig: StreamingConfigSnapshot;
  plugins: PluginInfo[];
  listenbrainz: ListenBrainzStatus;
  recentLogs: CoreDiagnosticLogEntry[];
}

const projectProviders = (
  sessions: ProviderSessionsSnapshot,
): Record<ManagedProviderPlatform, { authenticated: boolean }> => {
  const result = {} as Record<ManagedProviderPlatform, { authenticated: boolean }>;
  for (const platform of MANAGED_PROVIDER_PLATFORMS) {
    result[platform] = { authenticated: sessions[platform]?.authenticated === true };
  }
  return result;
};

export const buildCoreDiagnosticsSnapshot = (
  sources: DiagnosticsSnapshotSources,
): CoreDiagnosticsSnapshot => {
  const currentTrack =
    sources.playbackSession.current ??
    (sources.playbackSession.index >= 0
      ? sources.playbackSession.queue[sources.playbackSession.index]?.track
      : undefined);

  return {
    generatedAt: sources.generatedAt,
    uptimeSec: Math.round(sources.uptimeSec),
    logLevel: sources.logLevel,
    core: {
      ...sources.coreInfo,
      ...sources.buildDetails,
    },
    system: {
      osRelease: sources.osRelease,
      memory: sources.memory,
    },
    output: {
      selectedDeviceId: sources.selectedDeviceId,
      alsaPlaybackMode: sources.alsaPlaybackMode,
      activeOutput: sources.playbackStatus.output,
      localDevices: sources.localDevices,
      cachedUpnpRenderers: sources.cachedUpnpRenderers,
      upnpStatus: {
        selectedDeviceId: sources.selectedUpnpDeviceId,
        state: sources.upnpStatus.state,
        positionMs: sources.upnpStatus.position,
        durationMs: sources.upnpStatus.duration,
        isFinished: sources.upnpStatus.isFinished,
      },
    },
    playback: {
      state: sources.playbackStatus.state,
      positionMs: sources.playbackStatus.position,
      durationMs: sources.playbackStatus.duration,
      volume: sources.playbackStatus.volume,
      speed: sources.playbackStatus.speed,
      repeat: sources.playbackSession.repeat,
      shuffle: sources.playbackSession.shuffle,
      queueLength: sources.playbackSession.queue.length,
      currentIndex: sources.playbackSession.index,
      currentTrack: currentTrack
        ? {
            source: currentTrack.source,
            ...(currentTrack.quality?.codec ? { codec: currentTrack.quality.codec } : {}),
            ...(currentTrack.quality?.sampleRate
              ? { sampleRate: currentTrack.quality.sampleRate }
              : {}),
            ...(currentTrack.quality?.bitsPerSample
              ? { bitsPerSample: currentTrack.quality.bitsPerSample }
              : {}),
            ...(currentTrack.quality?.channels ? { channels: currentTrack.quality.channels } : {}),
            ...(currentTrack.quality?.bitRate ? { bitRate: currentTrack.quality.bitRate } : {}),
          }
        : null,
    },
    storage: {
      databaseOpen: sources.databaseOpen,
      schemaVersion: sources.schemaVersion,
      library: sources.libraryStats,
      cache: sources.cacheStats.map((item) => ({
        ...item,
        path: redactDiagnosticText(item.path),
      })),
    },
    integrations: {
      providers: projectProviders(sources.providerSessions),
      streaming: {
        serverCount: sources.streamingConfig.servers.length,
        serverTypes: [...new Set(sources.streamingConfig.servers.map((server) => server.type))],
        hasActiveServer: Boolean(sources.streamingConfig.activeServerId),
        connected: sources.streamingConfig.connectionStatus.connected,
        errorCode: sources.streamingConfig.connectionStatus.errorCode ?? null,
      },
      plugins: sources.plugins.map((plugin) => ({
        id: plugin.manifest.id,
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        enabled: plugin.enabled,
        status: plugin.status.state,
      })),
      listenbrainz: {
        enabled: sources.listenbrainz.enabled,
        linked: sources.listenbrainz.linked,
        state: sources.listenbrainz.state,
        pending: sources.listenbrainz.pending,
        dead: sources.listenbrainz.dead,
        processActive: sources.listenbrainz.processActive,
        lastError: sources.listenbrainz.lastError
          ? redactDiagnosticText(sources.listenbrainz.lastError)
          : null,
      },
    },
    recentLogs: sources.recentLogs,
  };
};

const safeCall = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export const collectCoreDiagnostics = async (): Promise<CoreDiagnosticsSnapshot> => {
  const mem = process.memoryUsage();
  const dbOpen = isDbOpen();
  const schemaVersion = dbOpen
    ? safeCall(() => Number(getDb().pragma("user_version", { simple: true })), null)
    : null;
  const libraryStats = dbOpen ? safeCall(() => getLibraryStats(), null) : null;
  const cacheStats = await getCacheStats().catch(() => [] as CacheStat[]);

  const fallbackPlaybackStatus: PlayerStatus = {
    state: "stopped",
    position: 0,
    duration: 0,
    volume: 1,
    speed: 1,
    isFinished: false,
    output: {
      deviceId: safeCall(() => getSelectedOutputDevice(), null),
      path: null,
      sampleProcessingAvailable: false,
    },
  };

  return buildCoreDiagnosticsSnapshot({
    generatedAt: new Date().toISOString(),
    uptimeSec: process.uptime(),
    logLevel: getLogLevelSnapshot(),
    coreInfo: getCoreInfo(),
    buildDetails: getCoreRuntimeBuildDetails(),
    osRelease: os.release(),
    memory: {
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
    },
    selectedDeviceId: safeCall(() => getSelectedOutputDevice(), null),
    alsaPlaybackMode: safeCall(() => getAlsaPlaybackMode(), "direct"),
    playbackStatus: safeCall(() => getPlaybackStatus(), fallbackPlaybackStatus),
    playbackSession: safeCall(() => getPlaybackSession(), {
      active: false,
      mode: "queue",
      queue: [],
      originalQueue: null,
      index: -1,
      current: null,
      repeat: "list",
      shuffle: "off",
    }),
    localDevices: safeCall(() => getOutputDevices(), []),
    cachedUpnpRenderers: safeCall(() => getCachedUpnpRenderers(), []),
    selectedUpnpDeviceId: safeCall(() => getSelectedUpnpOutput(), null),
    upnpStatus: safeCall(() => getUpnpOutputStatus(), {
      state: "stopped",
      position: 0,
      duration: 0,
      isFinished: false,
    }),
    databaseOpen: dbOpen,
    schemaVersion,
    libraryStats,
    cacheStats,
    providerSessions: safeCall(() => getProviderSessions(), {
      netease: { authenticated: false },
      qqmusic: { authenticated: false },
      kugou: { authenticated: false },
      qobuz: { authenticated: false },
      tidal: { authenticated: false },
    }),
    streamingConfig: safeCall(() => streamingControl.loadServers(), {
      servers: [],
      activeServerId: null,
      connectionStatus: { connected: false },
    }),
    plugins: safeCall(() => listPlugins(), []),
    listenbrainz: safeCall(() => getListenBrainzStatus(), {
      enabled: false,
      sendNowPlaying: false,
      linked: false,
      account: null,
      state: "disabled",
      pending: 0,
      dead: 0,
      lastError: null,
      processActive: false,
    }),
    recentLogs: getRecentLogs(),
  });
};
