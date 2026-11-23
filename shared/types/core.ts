/** Atom Core 与 Control 之间的最小兼容契约。 */

import type { ManagedProviderPlatform } from "./apis";
import type { CacheStat } from "./cache";
import type { AudioDevice, PlayerStatus, RepeatMode, ShuffleMode } from "./player";
import type { AlsaPlaybackMode } from "./settings";
import type { LibraryStats } from "./stats";

export const CORE_LOG_LEVELS = ["error", "warn", "info", "debug"] as const;
export type CoreLogLevel = (typeof CORE_LOG_LEVELS)[number];

export interface CoreProtocolInfo {
  version: number;
}

/**
 * Core 域能力开关。
 *
 * 托管在线平台的能力位不再逐个手写，而是由 `MANAGED_PROVIDER_PLATFORMS` 机械展开，
 * 这样「Core 真正支持的平台集合」与「发布产物声明的能力位」只有唯一来源，不会再漂移。
 */
export interface CoreCapabilities extends Record<ManagedProviderPlatform, boolean> {
  library: boolean;
  playback: boolean;
  download: boolean;
  diretta: boolean;
  remoteOutput: boolean;
}

export interface CoreInfo {
  name: string;
  version: string;
  commit: string;
  sourceDirty: boolean;
  platform: string;
  arch: string;
  node: string;
  nodeRange: string;
  nodeReference: string;
  runtime?: { name: "node" | "bun"; version: string };
  direttaSdkRelease?: number | null;
  direttaCpuVariant?: string | null;
  protocol: CoreProtocolInfo;
  capabilities: CoreCapabilities;
}

export interface CoreLogLevelSnapshot {
  level: CoreLogLevel;
  defaultLevel: CoreLogLevel;
  overridden: boolean;
}

export interface CoreDiagnosticLogEntry {
  timestamp: string;
  level: CoreLogLevel;
  scope: string;
  message: string;
}

export interface CoreDiagnosticsSnapshot {
  generatedAt: string;
  uptimeSec: number;
  logLevel: CoreLogLevelSnapshot;
  core: CoreInfo & {
    buildDate: string | null;
    nodeBundled: boolean | null;
    bunBundled: boolean | null;
    packaged: boolean;
  };
  system: {
    osRelease: string;
    memory: {
      rssBytes: number;
      heapUsedBytes: number;
      heapTotalBytes: number;
    };
  };
  output: {
    selectedDeviceId: string | null;
    alsaPlaybackMode: AlsaPlaybackMode;
    activeOutput: PlayerStatus["output"];
    localDevices: AudioDevice[];
    cachedUpnpRenderers: Array<{
      id: string;
      name: string;
      avTransportService: string;
      hasConnectionManager: boolean;
    }>;
    upnpStatus: {
      selectedDeviceId: string | null;
      state: PlayerStatus["state"];
      positionMs: number;
      durationMs: number;
      isFinished: boolean;
    };
  };
  playback: {
    state: PlayerStatus["state"];
    positionMs: number;
    durationMs: number;
    volume: number;
    speed: number;
    repeat: RepeatMode;
    shuffle: ShuffleMode;
    queueLength: number;
    currentIndex: number;
    currentTrack: {
      source: string;
      codec?: string;
      sampleRate?: number;
      bitsPerSample?: number;
      channels?: number;
      bitRate?: number;
    } | null;
  };
  storage: {
    databaseOpen: boolean;
    schemaVersion: number | null;
    library: LibraryStats | null;
    cache: CacheStat[];
  };
  integrations: {
    providers: Record<ManagedProviderPlatform, { authenticated: boolean }>;
    streaming: {
      serverCount: number;
      serverTypes: string[];
      hasActiveServer: boolean;
      connected: boolean;
      errorCode: string | null;
    };
    plugins: Array<{
      id: string;
      name: string;
      version: string;
      enabled: boolean;
      status: string;
    }>;
    listenbrainz: {
      enabled: boolean;
      linked: boolean;
      state: string;
      pending: number;
      dead: number;
      processActive: boolean;
      lastError: string | null;
    };
  };
  recentLogs: CoreDiagnosticLogEntry[];
}
