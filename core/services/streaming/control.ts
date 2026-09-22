import { isDbOpen } from "@main/database";
import { fetchBytes } from "@main/utils/fetchBytes";
import type { Album, Track } from "@shared/types/player";
import type {
  StreamingConnectResult,
  StreamingConfigSnapshot,
  StreamingConnectionStatus,
  StreamingLibrarySnapshot,
  StreamingPingResult,
  StreamingSearchResult,
  StreamingServerConfig,
  StreamingServerInput,
} from "@shared/types/streaming";
import { invalidateStreamingSession } from "./adapters/resolve";
import {
  addStreamingServer,
  getStreamingConfig,
  getStreamingServer,
  removeStreamingServer,
  setActiveStreamingServer,
  updateStreamingServer,
} from "./config";
import {
  connectStreamingServer,
  testStreamingConnection,
  withStreamingAdapter,
} from "./connection";
import { deleteLibraryByServer, getLibrarySnapshot, searchLibrary } from "./library";
import { cancelStreamingSync, queueStreamingSync } from "./sync";
import { publishCoreControlEvent } from "@main/services/coreControlEvents";

let connectionStatus: StreamingConnectionStatus = { connected: false };

const loadServers = (): StreamingConfigSnapshot => ({
  ...getStreamingConfig(),
  connectionStatus: { ...connectionStatus },
});

const publishConfig = (): StreamingConfigSnapshot => {
  const snapshot = loadServers();
  publishCoreControlEvent({ type: "streamingConfigUpdated", data: snapshot });
  return snapshot;
};

const connect = async (serverId: string): Promise<StreamingConnectResult> => {
  const result = await connectStreamingServer(serverId);
  const activeServerId = getStreamingConfig().activeServerId;
  if (activeServerId === serverId) {
    connectionStatus = result.ok
      ? { connected: true }
      : { connected: false, error: result.error, errorCode: result.code };
    publishConfig();
  }
  return result;
};

/** Streaming Core Control 服务；最终播放 URL 不属于本接口。 */
export const streamingControl = {
  loadServers,
  addServer: (input: StreamingServerInput): StreamingServerConfig => {
    const server = addStreamingServer(input);
    publishConfig();
    return server;
  },
  updateServer: (serverId: string, input: StreamingServerInput): StreamingServerConfig => {
    invalidateStreamingSession(serverId);
    cancelStreamingSync(serverId);
    if (getStreamingConfig().activeServerId === serverId) connectionStatus = { connected: false };
    const server = updateStreamingServer(serverId, input);
    publishConfig();
    return server;
  },
  removeServer: (serverId: string): void => {
    const wasActive = getStreamingConfig().activeServerId === serverId;
    invalidateStreamingSession(serverId);
    cancelStreamingSync(serverId);
    removeStreamingServer(serverId);
    if (wasActive) connectionStatus = { connected: false };
    if (isDbOpen()) deleteLibraryByServer(serverId);
    publishConfig();
  },
  setActiveServer: async (serverId: string | null): Promise<StreamingConfigSnapshot> => {
    setActiveStreamingServer(serverId);
    connectionStatus = { connected: false };
    if (serverId) {
      await connect(serverId);
      return loadServers();
    }
    return publishConfig();
  },
  testConnection: (input: StreamingServerInput, serverId?: string): Promise<StreamingPingResult> =>
    testStreamingConnection(input, serverId),
  connect,
  disconnect: (serverId: string): void => {
    invalidateStreamingSession(serverId);
    if (getStreamingConfig().activeServerId === serverId) {
      connectionStatus = { connected: false };
      publishConfig();
    }
  },
  /** Core 启动后自行恢复 active server，不依赖任何 Web Control 打开页面。 */
  restoreActiveConnection: async (): Promise<void> => {
    const serverId = getStreamingConfig().activeServerId;
    if (serverId) await connect(serverId);
  },
  getSnapshot: (serverId: string): StreamingLibrarySnapshot => getLibrarySnapshot(serverId),
  sync: (serverId: string, force = false): boolean =>
    queueStreamingSync(getStreamingServer(serverId), force),
  search: (serverId: string, query: string): StreamingSearchResult =>
    searchLibrary(serverId, query.slice(0, 200)),
  getAlbumSongs: (serverId: string, albumId: string): Promise<Track[]> =>
    withStreamingAdapter(serverId, (config, adapter) => adapter.getAlbumSongs(config, albumId)),
  getPlaylistSongs: (serverId: string, playlistId: string): Promise<Track[]> =>
    withStreamingAdapter(serverId, (config, adapter) =>
      adapter.getPlaylistSongs(config, playlistId),
    ),
  getArtistAlbums: (serverId: string, artistId: string): Promise<Album[]> =>
    withStreamingAdapter(serverId, (config, adapter) => adapter.getArtistAlbums(config, artistId)),
  getArtistSongs: (serverId: string, artistId: string): Promise<Track[]> =>
    withStreamingAdapter(serverId, (config, adapter) => adapter.getArtistSongs(config, artistId)),
  getLyrics: (
    serverId: string,
    trackId: string,
    hint?: { artist?: string; title?: string },
  ): Promise<string | null> =>
    withStreamingAdapter(serverId, (config, adapter) => adapter.getLyrics(config, trackId, hint)),
  getCover: async (serverId: string, coverId: string, size: number): Promise<Buffer | null> => {
    const boundedSize = Math.min(2000, Math.max(32, Number.isFinite(size) ? size : 300));
    return withStreamingAdapter(serverId, async (config, adapter) => {
      const url = await adapter.getCoverUrl(config, coverId, boundedSize);
      return fetchBytes(url, { requireImage: true });
    });
  },
};
