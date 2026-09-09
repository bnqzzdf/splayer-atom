import { isDbOpen } from "@main/database";
import { fetchBytes } from "@main/utils/fetchBytes";
import type { Album, Track } from "@shared/types/player";
import type {
  StreamingConnectResult,
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

/** Streaming Core Control 服务；最终播放 URL 不属于本接口。 */
export const streamingControl = {
  loadServers: getStreamingConfig,
  addServer: (input: StreamingServerInput): StreamingServerConfig => addStreamingServer(input),
  updateServer: (serverId: string, input: StreamingServerInput): StreamingServerConfig => {
    invalidateStreamingSession(serverId);
    cancelStreamingSync(serverId);
    return updateStreamingServer(serverId, input);
  },
  removeServer: (serverId: string): void => {
    invalidateStreamingSession(serverId);
    cancelStreamingSync(serverId);
    removeStreamingServer(serverId);
    if (isDbOpen()) deleteLibraryByServer(serverId);
  },
  setActiveServer: (serverId: string | null): void => setActiveStreamingServer(serverId),
  testConnection: (input: StreamingServerInput, serverId?: string): Promise<StreamingPingResult> =>
    testStreamingConnection(input, serverId),
  connect: (serverId: string): Promise<StreamingConnectResult> => connectStreamingServer(serverId),
  disconnect: (serverId: string): void => invalidateStreamingSession(serverId),
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
