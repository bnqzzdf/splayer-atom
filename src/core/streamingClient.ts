import type { Album, Artist, Playlist, Track } from "@shared/types/player";
import type {
  StreamingConnectResult,
  StreamingLibrarySnapshot,
  StreamingPingResult,
  StreamingSearchResult,
  StreamingServerConfig,
  StreamingServerInput,
} from "@shared/types/streaming";
import { controlAssetUrl } from "./controlAssets";
import { request } from "./controlClient";
import { subscribeCoreControlEvent } from "./controlEventClient";

const query = (values: Record<string, string>): string => new URLSearchParams(values).toString();

const mapTrack = (track: Track): Track => ({
  ...track,
  cover: controlAssetUrl(track.cover),
  coverOriginal: controlAssetUrl(track.coverOriginal),
});

const mapAlbum = (album: Album): Album => ({ ...album, cover: controlAssetUrl(album.cover) });
const mapArtist = (artist: Artist): Artist => ({
  ...artist,
  avatar: controlAssetUrl(artist.avatar),
});
const mapPlaylist = (playlist: Playlist): Playlist => ({
  ...playlist,
  cover: controlAssetUrl(playlist.cover),
});

const mapSnapshot = (snapshot: StreamingLibrarySnapshot): StreamingLibrarySnapshot => ({
  songs: snapshot.songs.map(mapTrack),
  albums: snapshot.albums.map(mapAlbum),
  artists: snapshot.artists.map(mapArtist),
  playlists: snapshot.playlists.map(mapPlaylist),
});

const mapSearch = (result: StreamingSearchResult): StreamingSearchResult => ({
  songs: result.songs.map(mapTrack),
  albums: result.albums.map(mapAlbum),
  artists: result.artists.map(mapArtist),
  playlists: result.playlists.map(mapPlaylist),
});

/** Desktop 与 Web 共用的 Streaming Core Protocol client；不暴露最终 playable URL。 */
export const streamingClient = {
  loadServers: (): Promise<{ servers: StreamingServerConfig[]; activeServerId: string | null }> =>
    request("/streaming/config"),
  addServer: (input: StreamingServerInput): Promise<StreamingServerConfig> =>
    request("/streaming/server", { method: "POST", body: JSON.stringify(input) }),
  updateServer: (serverId: string, input: StreamingServerInput): Promise<StreamingServerConfig> =>
    request(`/streaming/server/${encodeURIComponent(serverId)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  removeServer: async (serverId: string): Promise<void> => {
    await request(`/streaming/server/${encodeURIComponent(serverId)}`, { method: "DELETE" });
  },
  setActiveServer: async (serverId: string | null): Promise<void> => {
    await request("/streaming/active", {
      method: "POST",
      body: JSON.stringify({ serverId }),
    });
  },
  testConnection: (input: StreamingServerInput, serverId?: string): Promise<StreamingPingResult> =>
    request("/streaming/test", {
      method: "POST",
      body: JSON.stringify({ input, serverId }),
    }),
  connect: (serverId: string): Promise<StreamingConnectResult> =>
    request("/streaming/connect", {
      method: "POST",
      body: JSON.stringify({ serverId }),
    }),
  disconnect: async (serverId: string): Promise<void> => {
    await request("/streaming/disconnect", {
      method: "POST",
      body: JSON.stringify({ serverId }),
    });
  },
  getSnapshot: async (serverId: string): Promise<StreamingLibrarySnapshot> =>
    mapSnapshot(await request(`/streaming/snapshot?${query({ serverId })}`)),
  sync: async (serverId: string, force = false): Promise<boolean> =>
    (
      await request<{ started: boolean }>("/streaming/sync", {
        method: "POST",
        body: JSON.stringify({ serverId, force }),
      })
    ).started,
  search: async (serverId: string, searchQuery: string): Promise<StreamingSearchResult> =>
    mapSearch(await request(`/streaming/search?${query({ serverId, query: searchQuery })}`)),
  getAlbumSongs: async (serverId: string, albumId: string): Promise<Track[]> =>
    (await request<Track[]>(`/streaming/album-songs?${query({ serverId, albumId })}`)).map(
      mapTrack,
    ),
  getPlaylistSongs: async (serverId: string, playlistId: string): Promise<Track[]> =>
    (await request<Track[]>(`/streaming/playlist-songs?${query({ serverId, playlistId })}`)).map(
      mapTrack,
    ),
  getArtistAlbums: async (serverId: string, artistId: string): Promise<Album[]> =>
    (await request<Album[]>(`/streaming/artist-albums?${query({ serverId, artistId })}`)).map(
      mapAlbum,
    ),
  getArtistSongs: async (serverId: string, artistId: string): Promise<Track[]> =>
    (await request<Track[]>(`/streaming/artist-songs?${query({ serverId, artistId })}`)).map(
      mapTrack,
    ),
  getLyrics: async (
    serverId: string,
    trackId: string,
    hint?: { artist?: string; title?: string },
  ): Promise<string | null> =>
    (
      await request<{ lyric: string | null }>("/streaming/lyrics", {
        method: "POST",
        body: JSON.stringify({ serverId, trackId, hint }),
      })
    ).lyric,
  onLibraryUpdated: (callback: (serverId: string) => void): (() => void) =>
    subscribeCoreControlEvent("streamingLibraryUpdated", ({ serverId }) => callback(serverId)),
};
