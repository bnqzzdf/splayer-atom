import type {
  FolderActionResult,
  FolderBrowsePage,
  FolderContainerResult,
  FolderNavigationTarget,
  FolderPinEntry,
  FolderPlaylistResult,
  FolderRootEntry,
  FolderSearchPage,
  FolderTextMaterial,
} from "@shared/types/folderBrowser";
import type { Track } from "@shared/types/player";
import type { ScanProgress } from "@shared/types/library";
import { controlAssetUrl } from "./controlAssets";
import { coreApiOrigin, request } from "./controlClient";

const json = (body: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});

const mapTrack = (track: Track): Track => ({
  ...track,
  cover: controlAssetUrl(track.cover),
  coverOriginal: controlAssetUrl(track.coverOriginal),
});

const mapBrowse = (page: FolderBrowsePage): FolderBrowsePage => ({
  ...page,
  entries: page.entries.map((entry) =>
    entry.kind === "track" ? { ...entry, track: mapTrack(entry.track) } : entry,
  ),
});

const mapContainer = (result: FolderContainerResult): FolderContainerResult => ({
  ...result,
  tracks: result.tracks.map(mapTrack),
});

export const folderBrowserClient = {
  getRoots: (): Promise<{ roots: FolderRootEntry[]; pins: FolderPinEntry[] }> =>
    request("/library/folders/roots"),

  browse: async (
    path: string,
    cursor?: string,
    limit = 200,
    focusPath?: string,
  ): Promise<FolderBrowsePage> => {
    const params = new URLSearchParams({ path, limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    if (focusPath) params.set("focus", focusPath);
    return mapBrowse(await request<FolderBrowsePage>(`/library/folders/browse?${params}`));
  },

  openContainer: async (path: string): Promise<FolderContainerResult> =>
    mapContainer(
      await request<FolderContainerResult>(
        `/library/folders/container?path=${encodeURIComponent(path)}`,
      ),
    ),

  search: (
    query: string,
    cursor?: string,
    limit = 100,
    signal?: AbortSignal,
  ): Promise<FolderSearchPage> => {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return request(`/library/folders/search?${params}`, { signal });
  },

  getPins: (): Promise<FolderPinEntry[]> => request("/library/folders/pins"),
  pin: (path: string): Promise<FolderPinEntry[]> =>
    request("/library/folders/pins", json({ path })),
  unpin: (path: string): Promise<FolderPinEntry[]> =>
    request("/library/folders/pins", {
      method: "DELETE",
      body: JSON.stringify({ path }),
    }),

  scan: (path: string, incremental: boolean): Promise<{ ok: true }> =>
    request("/library/folders/scan", json({ path, incremental })),

  scanProgress: async (): Promise<ScanProgress> =>
    (await request<{ data: ScanProgress }>("/library/scan-progress")).data,

  location: (track: Track): Promise<FolderNavigationTarget> =>
    request("/library/folders/location", json({ track })),

  play: (
    path: string,
    mode: "play" | "shuffle" | "play-next" | "queue",
    recursive = true,
  ): Promise<FolderActionResult> => {
    const route =
      mode === "play"
        ? "play"
        : mode === "shuffle"
          ? "shuffle"
          : mode === "play-next"
            ? "play-next"
            : "queue";
    return request(`/library/folders/${route}`, json({ path, recursive }));
  },

  addToPlaylist: (
    playlistId: string,
    path: string,
    recursive = true,
  ): Promise<FolderPlaylistResult> =>
    request("/library/folders/playlist", json({ playlistId, path, recursive })),

  readText: (path: string): Promise<FolderTextMaterial> =>
    request(`/library/folders/material/text?path=${encodeURIComponent(path)}`),

  materialUrl: (path: string): string =>
    `${coreApiOrigin}/api/library/folders/material?path=${encodeURIComponent(path)}`,

  thumbnailUrl: (path: string): string =>
    `${coreApiOrigin}/api/library/folders/material/thumbnail?path=${encodeURIComponent(path)}`,
};
