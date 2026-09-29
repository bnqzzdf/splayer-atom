import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { Context } from "hono";
import { Hono } from "hono";
import type {
  FolderActionRequest,
  FolderBatchActionRequest,
  FolderBatchPlaylistRequest,
  FolderBatchTarget,
  FolderBrowseOrder,
  FolderBrowseSort,
  FolderPlaylistRequest,
  FolderPlaylistTrackRequest,
  FolderScanRequest,
} from "@shared/types/folderBrowser";
import type { Track } from "@shared/types/player";
import {
  addContainerTrackToPlaylist,
  addFolderBatchToPlaylist,
  addFolderToPlaylist,
  authorizeFolderPath,
  browseFolder,
  getFolderMaterial,
  listFolderRoots,
  listPinnedFolders,
  makeFolderDirectoryThumbnail,
  makeFolderMaterialThumbnail,
  openFolderContainer,
  pinFolder,
  readFolderTextMaterial,
  resolveTrackFolderLocation,
  runFolderAction,
  runFolderBatchAction,
  searchFolders,
  unpinFolder,
} from "@main/services/folderBrowser";
import { isScanning, startScan } from "@main/services/scanner";

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const errorResponse = (c: Context, error: unknown) => {
  const message = errorText(error);
  const status =
    message === "FOLDER_CURSOR_STALE"
      ? 409
      : message.includes("OUTSIDE_LIBRARY_ROOT")
        ? 403
        : message.includes("NOT_FOUND")
          ? 404
          : 400;
  return c.json({ error: message }, status);
};

const boundedInt = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
};

const isFolderBatchTarget = (value: unknown): value is FolderBatchTarget => {
  if (!value || typeof value !== "object") return false;
  const target = value as Record<string, unknown>;
  if (target.kind === "path") return typeof target.path === "string" && !!target.path;
  return (
    target.kind === "container-track" &&
    typeof target.containerPath === "string" &&
    !!target.containerPath &&
    typeof target.trackId === "string" &&
    !!target.trackId
  );
};

interface ByteRange {
  start: number;
  end: number;
}

const parseRange = (header: string | undefined, size: number): ByteRange | "invalid" | null => {
  if (!header) return null;
  if (!header.startsWith("bytes=") || header.includes(",")) return "invalid";
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) return "invalid";
  const first = match[1];
  const second = match[2];
  if (!first && !second) return "invalid";
  if (!first) {
    const suffix = Number(second);
    if (!Number.isInteger(suffix) || suffix <= 0) return "invalid";
    return { start: Math.max(0, size - suffix), end: Math.max(0, size - 1) };
  }
  const start = Number(first);
  const end = second ? Number(second) : size - 1;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return "invalid";
  }
  return { start, end: Math.min(end, size - 1) };
};

const streamMaterial = async (c: Context) => {
  const input = c.req.query("path") ?? "";
  if (!input) return c.json({ error: "path_required" }, 400);
  try {
    const material = await getFolderMaterial(input);
    if (material.entry.materialType === "text") {
      return c.json({ error: "FOLDER_TEXT_USE_TEXT_ENDPOINT" }, 400);
    }
    const range = parseRange(c.req.header("range"), material.entry.size);
    c.header("Accept-Ranges", "bytes");
    c.header("Content-Type", material.mime);
    c.header("Cache-Control", "private, max-age=300");
    c.header(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(material.entry.name)}`,
    );
    if (range === "invalid") {
      c.header("Content-Range", `bytes */${material.entry.size}`);
      return c.body(null, 416);
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(0, material.entry.size - 1);
    const status = range ? 206 : 200;
    if (range) c.header("Content-Range", `bytes ${start}-${end}/${material.entry.size}`);
    c.header("Content-Length", String(material.entry.size === 0 ? 0 : end - start + 1));
    if (material.entry.size === 0) return c.body(null, status);
    const stream = Readable.toWeb(createReadStream(material.entry.path, { start, end }));
    return new Response(stream as ReadableStream, {
      status,
      headers: c.res.headers,
    });
  } catch (error) {
    return errorResponse(c, error);
  }
};

/** Core-owned Local Folder Browser routes. */
export const buildFolderRoutes = (): Hono => {
  const api = new Hono();

  api.get("/library/folders/roots", async (c) => {
    try {
      const [roots, pins] = await Promise.all([listFolderRoots(), listPinnedFolders()]);
      return c.json({ roots, pins });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.get("/library/folders/browse", async (c) => {
    const input = c.req.query("path") ?? "";
    if (!input) return c.json({ error: "path_required" }, 400);
    const sortValue = c.req.query("sort");
    const orderValue = c.req.query("order");
    if (
      sortValue !== undefined &&
      sortValue !== "name" &&
      sortValue !== "mtime" &&
      sortValue !== "track"
    ) {
      return c.json({ error: "FOLDER_BROWSE_SORT_INVALID" }, 400);
    }
    if (orderValue !== undefined && orderValue !== "asc" && orderValue !== "desc") {
      return c.json({ error: "FOLDER_BROWSE_ORDER_INVALID" }, 400);
    }
    const sort: FolderBrowseSort =
      sortValue === "mtime" || sortValue === "track" ? sortValue : "name";
    const order: FolderBrowseOrder = orderValue === "desc" ? "desc" : "asc";
    try {
      return c.json(
        await browseFolder(
          input,
          c.req.query("cursor"),
          boundedInt(c.req.query("limit"), 200, 1, 500),
          c.req.query("focus"),
          c.req.query("filter"),
          sort,
          order,
        ),
      );
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.get("/library/folders/container", async (c) => {
    const input = c.req.query("path") ?? "";
    if (!input) return c.json({ error: "path_required" }, 400);
    try {
      return c.json(await openFolderContainer(input));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.get("/library/folders/search", async (c) => {
    const query = c.req.query("q") ?? "";
    try {
      return c.json(
        await searchFolders(
          query,
          c.req.query("cursor"),
          boundedInt(c.req.query("limit"), 100, 1, 200),
          c.req.raw.signal,
          c.req.query("path"),
        ),
      );
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.get("/library/folders/pins", async (c) => c.json(await listPinnedFolders()));
  api.post("/library/folders/pins", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { path?: unknown } | null;
    if (typeof body?.path !== "string" || !body.path) {
      return c.json({ error: "path_required" }, 400);
    }
    try {
      return c.json(await pinFolder(body.path));
    } catch (error) {
      return errorResponse(c, error);
    }
  });
  api.delete("/library/folders/pins", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { path?: unknown } | null;
    if (typeof body?.path !== "string" || !body.path) {
      return c.json({ error: "path_required" }, 400);
    }
    try {
      return c.json(await unpinFolder(body.path));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.post("/library/folders/scan", async (c) => {
    const body = (await c.req.json().catch(() => null)) as FolderScanRequest | null;
    if (!body || typeof body.path !== "string" || typeof body.incremental !== "boolean") {
      return c.json({ error: "folder_scan_request_invalid" }, 400);
    }
    if (isScanning()) return c.json({ error: "scan_already_running" }, 409);
    try {
      const scope = await authorizeFolderPath(body.path);
      const started = startScan([scope.path], body.incremental);
      return started ? c.json({ ok: true }) : c.json({ error: "scan_already_running" }, 409);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.post("/library/folders/location", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { track?: unknown } | null;
    if (!body?.track || typeof body.track !== "object") {
      return c.json({ error: "track_required" }, 400);
    }
    try {
      return c.json(resolveTrackFolderLocation(body.track as Track));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  for (const [route, mode] of [
    ["/library/folders/play", "play"],
    ["/library/folders/shuffle", "shuffle"],
    ["/library/folders/play-next", "play-next"],
    ["/library/folders/queue", "queue"],
  ] as const) {
    api.post(route, async (c) => {
      const body = (await c.req.json().catch(() => null)) as FolderActionRequest | null;
      if (!body || typeof body.path !== "string") {
        return c.json({ error: "folder_action_request_invalid" }, 400);
      }
      try {
        return c.json(await runFolderAction(mode, body.path, body.recursive !== false));
      } catch (error) {
        return errorResponse(c, error);
      }
    });
  }

  for (const [route, mode] of [
    ["/library/folders/batch/play", "play"],
    ["/library/folders/batch/play-next", "play-next"],
    ["/library/folders/batch/queue", "queue"],
  ] as const) {
    api.post(route, async (c) => {
      const body = (await c.req.json().catch(() => null)) as FolderBatchActionRequest | null;
      if (
        !body ||
        !Array.isArray(body.targets) ||
        body.targets.length === 0 ||
        !body.targets.every(isFolderBatchTarget)
      ) {
        return c.json({ error: "folder_batch_action_request_invalid" }, 400);
      }
      try {
        return c.json(await runFolderBatchAction(mode, body.targets));
      } catch (error) {
        return errorResponse(c, error);
      }
    });
  }

  api.post("/library/folders/playlist", async (c) => {
    const body = (await c.req.json().catch(() => null)) as FolderPlaylistRequest | null;
    if (!body || typeof body.path !== "string" || typeof body.playlistId !== "string") {
      return c.json({ error: "folder_playlist_request_invalid" }, 400);
    }
    try {
      return c.json(
        await addFolderToPlaylist(body.playlistId, body.path, body.recursive !== false),
      );
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.post("/library/folders/playlist-track", async (c) => {
    const body = (await c.req.json().catch(() => null)) as FolderPlaylistTrackRequest | null;
    if (
      !body ||
      typeof body.playlistId !== "string" ||
      typeof body.containerPath !== "string" ||
      typeof body.trackId !== "string"
    ) {
      return c.json({ error: "folder_playlist_track_request_invalid" }, 400);
    }
    try {
      return c.json(
        await addContainerTrackToPlaylist(body.playlistId, body.containerPath, body.trackId),
      );
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.post("/library/folders/batch/playlist", async (c) => {
    const body = (await c.req.json().catch(() => null)) as FolderBatchPlaylistRequest | null;
    if (
      !body ||
      typeof body.playlistId !== "string" ||
      !body.playlistId ||
      !Array.isArray(body.targets) ||
      body.targets.length === 0 ||
      !body.targets.every(isFolderBatchTarget)
    ) {
      return c.json({ error: "folder_batch_playlist_request_invalid" }, 400);
    }
    try {
      return c.json(await addFolderBatchToPlaylist(body.playlistId, body.targets));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.get("/library/folders/material/text", async (c) => {
    const input = c.req.query("path") ?? "";
    if (!input) return c.json({ error: "path_required" }, 400);
    try {
      return c.json(await readFolderTextMaterial(input));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.get("/library/folders/material/thumbnail", async (c) => {
    const input = c.req.query("path") ?? "";
    if (!input) return c.json({ error: "path_required" }, 400);
    try {
      const bytes = await makeFolderMaterialThumbnail(input);
      return new Response(Uint8Array.from(bytes).buffer, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "private, max-age=300",
        },
      });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.get("/library/folders/directory/thumbnail", async (c) => {
    const input = c.req.query("path") ?? "";
    if (!input) return c.json({ error: "path_required" }, 400);
    try {
      const bytes = await makeFolderDirectoryThumbnail(input);
      if (!bytes) return c.body(null, 404);
      return new Response(Uint8Array.from(bytes).buffer, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "private, max-age=300",
        },
      });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.get("/library/folders/material", streamMaterial);
  return api;
};
