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
import { getPlayer } from "@main/services/engine";
import * as nowPlaying from "@main/services/nowPlaying";
import { cancelScan, isScanning, startScan } from "@main/services/scanner";
import { store } from "@main/store";

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

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

  api.get("/library/albums/:albumName/tracks", (c) => {
    try {
      return c.json({ data: getAlbumTracks(c.req.param("albumName")) });
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

      const includes = (value: string): boolean => value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
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
    store.set("library.scanDirs", [...new Set(dirs)]);
    return c.json({ success: true, data: store.get("library.scanDirs") });
  });

  api.post("/library/scan-dirs/add", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { dir?: unknown } | null;
    const dir = typeof body?.dir === "string" ? body.dir.trim() : "";
    if (!dir) return c.json({ success: false, error: "dir_required" }, 400);
    const dirs = store.get("library.scanDirs") as string[];
    if (dirs.includes(dir)) return c.json({ success: false, error: "SCAN_DIR_EXISTS" }, 409);
    store.set("library.scanDirs", [...dirs, dir]);
    return c.json({ success: true, data: dir });
  });

  api.delete("/library/scan-dirs", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { dir?: unknown } | null;
    const dir = typeof body?.dir === "string" ? body.dir.trim() : "";
    if (!dir) return c.json({ success: false, error: "dir_required" }, 400);
    const dirs = store.get("library.scanDirs") as string[];
    if (!dirs.includes(dir)) return c.json({ success: false, error: "SCAN_DIR_NOT_FOUND" }, 404);
    if (isScanning()) cancelScan();
    store.set(
      "library.scanDirs",
      dirs.filter((item) => item !== dir),
    );
    deleteTracksByDir(dir);
    return c.json({ success: true });
  });

  api.get("/library/is-scanning", (c) => c.json({ data: isScanning() }));

  api.post("/library/scan", async (c) => {
    try {
      const body = (await c.req.json().catch(() => null)) as { incremental?: boolean } | null;
      const dirs = store.get("library.scanDirs") as string[];
      if (dirs.length === 0) return c.json({ success: false, error: "scan_no_dirs" }, 400);
      startScan(dirs, body?.incremental !== false);
      return c.json({ success: true });
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
