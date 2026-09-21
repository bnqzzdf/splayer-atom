import { Hono } from "hono";
import {
  deleteTracksByDir,
  getAlbumList,
  getAlbumTracks,
  getAllTracks,
  getArtistList,
  getArtistTracks,
  getRandomTrack,
  getRandomTracks,
  getTrackCount,
  getTracksByIds,
  searchTracks,
} from "@main/database";
import {
  addPlaylistTracks,
  clearPlaylists,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  getPlaylists,
  importLegacyPlaylists,
  removePlaylistTracks,
  updatePlaylist,
} from "@main/database/playlists";
import { fetchArtistAvatar, prefetchArtistAvatars } from "@main/apis/musicbrainz";
import type {
  LegacyPlaylistRecord,
  PlaylistCreateInput,
  PlaylistUpdateInput,
} from "@shared/types/playlist";
import type { TagEditRequest } from "@shared/types/tagEditor";
import { getPlayer } from "@main/services/engine";
import * as nowPlaying from "@main/services/nowPlaying";
import { cancelScan, getScanProgress, isScanning, startScan } from "@main/services/scanner";
import { resolveCoreDirectory } from "@main/services/coreFilesystem";
import { removePinsUnderRoot } from "@main/services/folderBrowser";
import { publishCoreControlEvent } from "@main/services/coreControlEvents";
import { publishLibraryRevision } from "@main/services/libraryRevision";
import { deleteLibraryFiles, readLibraryTags, writeLibraryTags } from "@main/services/libraryFiles";
import { store } from "@main/store";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const visibleTracks = () => {
  const all = getAllTracks();
  const cueContainers = new Set<string>();
  for (const track of all) {
    if (track.cueAudioPath) cueContainers.add(track.cueAudioPath);
  }
  return all.filter((track) => !track.path || !cueContainers.has(track.path));
};

const page = <T>(items: T[], offset: number, limit: number): { data: T[]; total: number } => {
  const safeOffset = Math.max(0, offset | 0);
  const safeLimit = limit > 0 ? Math.min(limit | 0, 500) : items.length;
  return {
    data: items.slice(safeOffset, safeOffset + safeLimit),
    total: items.length,
  };
};

/**
 * Retained tinyLMS HTTP compatibility that can be expressed safely as thin wrappers
 * over current SPlayer main-process state. Filesystem-root mutation, direct source load,
 * queue ownership, Zones, PCM streaming, and Diretta remain intentionally outside this slice.
 */
export const buildAtomCompatRoutes = (): Hono => {
  const api = new Hono();

  api.get("/lyrics/current", (c) => {
    const snapshot = nowPlaying.snapshot();
    return c.json({
      trackId: snapshot.track?.id ?? null,
      lines: snapshot.lyric ?? [],
      source: snapshot.source,
      offsetMs: snapshot.lyricOffsetMs ?? 0,
    });
  });

  api.get("/library/tracks", (c) => {
    try {
      const data = visibleTracks();
      return c.json({ data, total: getTrackCount() });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  api.get("/library/albums", (c) => {
    try {
      return c.json({ data: getAlbumList() });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  api.get("/library/artists", (c) => {
    try {
      return c.json({ data: getArtistList() });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  api.get("/library/albums/:albumId/tracks", (c) => {
    try {
      return c.json({
        data: getAlbumTracks(c.req.param("albumId"), c.req.query("name")),
      });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  api.get("/library/artists/:artistName/tracks", (c) => {
    try {
      return c.json({ data: getArtistTracks(c.req.param("artistName")) });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  api.get("/library/tracks/by-ids", (c) => {
    try {
      const ids = (c.req.query("ids") ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      return c.json({ data: ids.length === 0 ? [] : getTracksByIds(ids) });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  api.get("/library/search", (c) => {
    try {
      const query = (c.req.query("q") ?? "").trim();
      const type = (c.req.query("type") ?? "songs").toLowerCase();
      const offset = Number(c.req.query("offset") ?? 0) || 0;
      const limit = Number(c.req.query("limit") ?? 0) || 0;
      if (!query) return c.json({ data: [], total: 0 });

      const includes = (value: string): boolean =>
        value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
      if (type === "albums") {
        const items = getAlbumList().filter((item) => includes(item.name));
        return c.json(page(items, offset, limit));
      }
      if (type === "artists") {
        const items = getArtistList().filter((item) => includes(item.name));
        return c.json(page(items, offset, limit));
      }
      if (type === "playlists") return c.json({ data: [], total: 0 });
      return c.json(page(searchTracks(query), offset, limit));
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  api.get("/library/random", (c) => {
    try {
      const limit = Math.max(1, Math.min(100, Number(c.req.query("limit") ?? 1) || 1));
      return c.json({ data: getRandomTracks(limit) });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  api.get("/library/random-one", (c) => {
    try {
      return c.json({ data: getRandomTrack() });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  api.get("/library/count", (c) => {
    try {
      return c.json({ data: getTrackCount() });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  api.get("/library/scan-dirs", (c) => c.json({ data: store.get("library.scanDirs") }));

  api.post("/library/scan-dirs", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { dirs?: unknown } | null;
    if (!Array.isArray(body?.dirs) || !body.dirs.every((dir) => typeof dir === "string")) {
      return c.json({ success: false, error: "dirs_string_array_required" }, 400);
    }
    const dirs = body.dirs.map((dir) => dir.trim()).filter(Boolean);
    const next = [...new Set(dirs)];
    const previous = store.get("library.scanDirs") as string[];
    store.set("library.scanDirs", next);
    for (const removed of previous.filter((dir) => !next.includes(dir))) {
      removePinsUnderRoot(removed);
    }
    publishCoreControlEvent({ type: "libraryRootsChanged", data: { paths: next } });
    return c.json({ success: true, data: next });
  });

  api.post("/library/scan-dirs/add", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { dir?: unknown } | null;
    const requestedDir = typeof body?.dir === "string" ? body.dir.trim() : "";
    if (!requestedDir) return c.json({ success: false, error: "dir_required" }, 400);
    let dir: string;
    try {
      dir = await resolveCoreDirectory(requestedDir);
    } catch (error) {
      return c.json({ success: false, error: errorMessage(error) }, 400);
    }
    const dirs = store.get("library.scanDirs") as string[];
    if (dirs.includes(dir)) return c.json({ success: false, error: "SCAN_DIR_EXISTS" }, 409);
    const next = [...dirs, dir];
    store.set("library.scanDirs", next);
    publishCoreControlEvent({ type: "libraryRootsChanged", data: { paths: next } });
    return c.json({ success: true, data: dir });
  });

  api.delete("/library/scan-dirs", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { dir?: unknown } | null;
    const dir = typeof body?.dir === "string" ? body.dir.trim() : "";
    if (!dir) return c.json({ success: false, error: "dir_required" }, 400);
    const dirs = store.get("library.scanDirs") as string[];
    if (!dirs.includes(dir)) return c.json({ success: false, error: "SCAN_DIR_NOT_FOUND" }, 404);
    if (isScanning()) cancelScan();
    const next = dirs.filter((item) => item !== dir);
    store.set("library.scanDirs", next);
    publishCoreControlEvent({ type: "libraryRootsChanged", data: { paths: next } });
    removePinsUnderRoot(dir);
    deleteTracksByDir(dir);
    publishLibraryRevision();
    return c.json({ success: true });
  });

  api.post("/library/tags/read", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { path?: unknown } | null;
    if (typeof body?.path !== "string" || !body.path) {
      return c.json({ success: false, error: "path_required" }, 400);
    }
    try {
      return c.json({ success: true, data: await readLibraryTags(body.path) });
    } catch (error) {
      return c.json({ success: false, error: errorMessage(error) }, 400);
    }
  });

  api.post("/library/tags/write", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { edits?: unknown } | null;
    if (
      !Array.isArray(body?.edits) ||
      !body.edits.every(
        (edit) =>
          !!edit && typeof edit === "object" && typeof (edit as TagEditRequest).path === "string",
      )
    ) {
      return c.json({ success: false, error: "tag_edits_required" }, 400);
    }
    try {
      return c.json({
        success: true,
        data: await writeLibraryTags(body.edits as TagEditRequest[]),
      });
    } catch (error) {
      return c.json({ success: false, error: errorMessage(error) }, 400);
    }
  });

  api.delete("/library/files", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { paths?: unknown } | null;
    if (!Array.isArray(body?.paths) || !body.paths.every((item) => typeof item === "string")) {
      return c.json({ success: false, error: "paths_string_array_required" }, 400);
    }
    try {
      return c.json({ success: true, data: await deleteLibraryFiles(body.paths) });
    } catch (error) {
      return c.json({ success: false, error: errorMessage(error) }, 400);
    }
  });

  api.get("/library/is-scanning", (c) => c.json({ data: isScanning() }));
  api.get("/library/scan-progress", (c) => c.json({ data: getScanProgress() }));

  api.post("/library/scan", async (c) => {
    try {
      const body = (await c.req.json().catch(() => null)) as { incremental?: boolean } | null;
      const dirs = store.get("library.scanDirs") as string[];
      if (dirs.length === 0) return c.json({ success: false, error: "scan_no_dirs" }, 400);
      const started = startScan(dirs, body?.incremental !== false);
      return started
        ? c.json({ success: true })
        : c.json({ success: false, error: "scan_already_running" }, 409);
    } catch (error) {
      return c.json({ success: false, error: errorMessage(error) }, 500);
    }
  });

  api.post("/library/scan/cancel", (c) => {
    try {
      cancelScan();
      return c.json({ success: true });
    } catch (error) {
      return c.json({ success: false, error: errorMessage(error) }, 500);
    }
  });

  api.get("/library/artists/:artistName/avatar", async (c) => {
    try {
      return c.json({ success: true, data: await fetchArtistAvatar(c.req.param("artistName")) });
    } catch (error) {
      return c.json({ success: false, error: errorMessage(error) }, 500);
    }
  });

  api.post("/library/artists/avatars", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { names?: unknown } | null;
    if (!Array.isArray(body?.names) || !body.names.every((name) => typeof name === "string")) {
      return c.json({ success: false, error: "names_string_array_required" }, 400);
    }
    try {
      return c.json({ success: true, data: await prefetchArtistAvatars(body.names) });
    } catch (error) {
      return c.json({ success: false, error: errorMessage(error) }, 500);
    }
  });

  api.get("/playlists", (c) => c.json(getPlaylists()));
  api.get("/playlists/:id", (c) => c.json(getPlaylist(c.req.param("id"))));
  api.post("/playlists", async (c) =>
    c.json(createPlaylist((await c.req.json()) as PlaylistCreateInput)),
  );
  api.patch("/playlists/:id", async (c) =>
    c.json(updatePlaylist(c.req.param("id"), (await c.req.json()) as PlaylistUpdateInput)),
  );
  api.delete("/playlists/:id", (c) => {
    deletePlaylist(c.req.param("id"));
    return c.json({ ok: true });
  });
  api.post("/playlists/:id/tracks", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { trackIds?: unknown } | null;
    if (!Array.isArray(body?.trackIds) || !body.trackIds.every((id) => typeof id === "string")) {
      return c.json({ error: "trackIds_string_array_required" }, 400);
    }
    return c.json({ count: addPlaylistTracks(c.req.param("id"), body.trackIds) });
  });
  api.delete("/playlists/:id/tracks", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { trackIds?: unknown } | null;
    if (!Array.isArray(body?.trackIds) || !body.trackIds.every((id) => typeof id === "string")) {
      return c.json({ error: "trackIds_string_array_required" }, 400);
    }
    return c.json({ count: removePlaylistTracks(c.req.param("id"), body.trackIds) });
  });
  api.post("/playlists/import-legacy", async (c) => {
    importLegacyPlaylists((await c.req.json()) as LegacyPlaylistRecord[]);
    return c.json({ ok: true });
  });
  api.delete("/playlists", (c) => {
    clearPlaylists();
    return c.json({ ok: true });
  });

  api.get("/output/scan", (c) => {
    try {
      return c.json({ success: true, data: getPlayer().getOutputDevices() });
    } catch (error) {
      return c.json({ success: false, error: errorMessage(error) }, 500);
    }
  });

  return api;
};
