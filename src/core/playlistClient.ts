import type {
  LegacyPlaylistRecord,
  PlaylistApi,
  PlaylistDetail,
  PlaylistSummary,
  PlaylistUpdateInput,
} from "@shared/types/playlist";
import type { Track } from "@shared/types/player";
import { controlAssetUrl, serverAssetUrl } from "./controlAssets";
import { request } from "./controlClient";

const mapTrack = (track: Track): Track => ({
  ...track,
  cover: controlAssetUrl(track.cover),
  coverOriginal: controlAssetUrl(track.coverOriginal),
});

const mapSummary = (playlist: PlaylistSummary): PlaylistSummary => ({
  ...playlist,
  cover: controlAssetUrl(playlist.cover),
});

const mapDetail = (playlist: PlaylistDetail | null): PlaylistDetail | null =>
  playlist
    ? {
        ...mapSummary(playlist),
        tracks: playlist.tracks.map(mapTrack),
      }
    : null;

const toServerUpdate = (input: PlaylistUpdateInput): PlaylistUpdateInput => ({
  ...input,
  cover: serverAssetUrl(input.cover),
});

const toServerLegacy = (record: LegacyPlaylistRecord): LegacyPlaylistRecord => ({
  ...record,
  cover: serverAssetUrl(record.cover),
});

/** Desktop 与 Web 共用的 Core Playlist request client。 */
export const playlistClient: PlaylistApi = {
  list: async () => (await request<PlaylistSummary[]>("/playlists")).map(mapSummary),
  get: async (id) =>
    mapDetail(await request<PlaylistDetail | null>(`/playlists/${encodeURIComponent(id)}`)),
  create: async (input) =>
    mapSummary(
      await request<PlaylistSummary>("/playlists", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ),
  update: async (id, input) => {
    const playlist = await request<PlaylistSummary | null>(`/playlists/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(toServerUpdate(input)),
    });
    return playlist ? mapSummary(playlist) : null;
  },
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
    await request("/playlists/import-legacy", {
      method: "POST",
      body: JSON.stringify(records.map(toServerLegacy)),
    });
  },
  clear: async () => {
    await request("/playlists", { method: "DELETE" });
  },
};
