import type { AlbumSummary, ArtistSummary, LibraryApi } from "@shared/types/library";
import type { IpcResponse, Track } from "@shared/types/player";
import type { TagEditRequest, TagWriteOutcome, TrackTags } from "@shared/types/tagEditor";
import { request } from "@/core/controlClient";
import { controlAssetUrl } from "@/core/controlAssets";

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const asIpc = async <T>(loader: () => Promise<T>): Promise<IpcResponse<T>> => {
  try {
    return { success: true, data: await loader() };
  } catch (error) {
    return { success: false, error: errorText(error) };
  }
};

const json = (body: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});

/** 将 Core canonical Track 投影为当前 Control 可展示的资源 URL。 */
const mapTrack = (track: Track): Track => ({
  ...track,
  cover: controlAssetUrl(track.cover),
  coverOriginal: controlAssetUrl(track.coverOriginal),
});

const mapAlbum = (album: AlbumSummary): AlbumSummary => ({
  ...album,
  cover: controlAssetUrl(album.cover),
});

const mapArtist = (artist: ArtistSummary): ArtistSummary => ({
  ...artist,
  cover: controlAssetUrl(artist.cover),
});

/** Library Core Domain request client。 */
export const libraryClient: LibraryApi = {
  scan: (incremental = true) =>
    request<IpcResponse>("/library/scan", json({ incremental })).catch((error) => ({
      success: false,
      error: errorText(error),
    })),

  cancelScan: () =>
    request<IpcResponse>("/library/scan/cancel", { method: "POST" }).catch((error) => ({
      success: false,
      error: errorText(error),
    })),

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

  getAlbumTracks: (albumId, albumName) =>
    asIpc(async () =>
      (
        await request<{ data: Track[] }>(
          `/library/albums/${encodeURIComponent(albumId)}/tracks${
            albumName ? `?name=${encodeURIComponent(albumName)}` : ""
          }`,
        )
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

  addScanDir: (dir) => {
    if (!dir?.trim()) return Promise.resolve({ success: false, error: "CORE_DIRECTORY_REQUIRED" });
    return request<IpcResponse<string>>("/library/scan-dirs/add", json({ dir })).catch((error) => ({
      success: false,
      error: errorText(error),
    }));
  },

  removeScanDir: (dir) =>
    request<IpcResponse>("/library/scan-dirs", {
      method: "DELETE",
      body: JSON.stringify({ dir }),
    }).catch((error) => ({ success: false, error: errorText(error) })),

  getScanDirs: () =>
    asIpc(async () => (await request<{ data: string[] }>("/library/scan-dirs")).data),

  getLikedTrackIds: () =>
    asIpc(async () => (await request<{ data: string[] }>("/library/liked")).data),

  setTrackLiked: (trackId, liked) =>
    request<IpcResponse<string[]>>("/library/liked", json({ trackId, liked })).catch((error) => ({
      success: false,
      error: errorText(error),
    })),

  importLikedTrackIds: (trackIds) =>
    request<IpcResponse<string[]>>("/library/liked/import", json({ trackIds })).catch((error) => ({
      success: false,
      error: errorText(error),
    })),
  readTags: (path) =>
    request<IpcResponse<TrackTags>>("/library/tags/read", json({ path })).catch((error) => ({
      success: false,
      error: errorText(error),
    })),

  writeTags: (edits: TagEditRequest[]) =>
    request<IpcResponse<TagWriteOutcome[]>>("/library/tags/write", json({ edits })).catch(
      (error) => ({
        success: false,
        error: errorText(error),
      }),
    ),

  fetchArtistAvatar: (artistName) =>
    request<IpcResponse<string | null>>(
      `/library/artists/${encodeURIComponent(artistName)}/avatar`,
    ).then((result) => ({
      ...result,
      data: result.data ? (controlAssetUrl(result.data) ?? result.data) : result.data,
    })),

  prefetchArtistAvatars: (artistNames) =>
    request<IpcResponse<Record<string, string>>>(
      "/library/artists/avatars",
      json({ names: artistNames }),
    ).then((result) => ({
      ...result,
      data: result.data
        ? Object.fromEntries(
            Object.entries(result.data).map(([key, value]) => [
              key,
              controlAssetUrl(value) ?? value,
            ]),
          )
        : result.data,
    })),
};
