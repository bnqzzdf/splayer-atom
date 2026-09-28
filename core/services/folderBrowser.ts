import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";
import type {
  FolderActionResult,
  FolderBatchTarget,
  FolderBrowseEntry,
  FolderBrowseOrder,
  FolderBrowsePage,
  FolderBrowseSort,
  FolderContainerResult,
  FolderMaterialEntry,
  FolderMaterialType,
  FolderNavigationTarget,
  FolderPinEntry,
  FolderRootEntry,
  FolderSearchPage,
  FolderSearchResult,
  FolderTextMaterial,
} from "@shared/types/folderBrowser";
import type { PlaybackQueueItem, Track } from "@shared/types/player";
import { getTracksByPhysicalPaths, upsertTracks, type UpsertTrack } from "@main/database";
import { addPlaylistTracks } from "@main/database/playlists";
import { getEngine } from "@main/services/engine";
import {
  appendQueue,
  getPlaybackSession,
  insertQueue,
  replaceQueue,
  selectIndex,
  setShuffle,
} from "@main/services/playbackSession";
import { getCoverCacheDir, isWin } from "@main/utils/config";
import { decodeAuto, readFileAutoEncoding } from "@main/utils/encoding";
import { createLocalAlbumId, inferDiscNumberFromPath } from "@main/utils/localAlbum";
import { fromCacheUrl, toCacheUrl } from "@main/atom/cacheUrl";
import { localTrackContainerPath, sacdIsoPathFromVirtual } from "@main/utils/localPhysicalSource";
import { parseAlbum, parseArtists } from "@main/utils/metadata";
import { store } from "@main/store";
import { scannedToUpsert } from "./scanner";
import { getCueAudioPath, inspectCueSheet, parseCueSheet } from "./cue";
import { getLibraryRevision, publishLibraryRevision } from "./libraryRevision";
import { repairMissingCoverCache } from "./coverCacheRepair";
import { publishCoreControlEvent } from "@main/services/coreControlEvents";

const ORDINARY_AUDIO_EXTENSIONS = new Set([
  "mp3",
  "flac",
  "wav",
  "ogg",
  "aac",
  "m4a",
  "wma",
  "opus",
  "ape",
  "dsf",
  "dff",
  "dsdiff",
]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
const TEXT_EXTENSIONS = new Set(["txt", "log", "nfo", "md"]);
const MAX_BROWSE_LIMIT = 500;
const DEFAULT_BROWSE_LIMIT = 200;
const MAX_SEARCH_VISITS = 100_000;
const MAX_CUE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;
const MAX_THUMBNAIL_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_THUMBNAIL_CACHE_ITEMS = 128;
const DIRECTORY_ARTWORK_NAMES = ["cover", "folder", "album", "front", "封面", "封套"];
const thumbnailCache = new Map<string, Buffer>();
const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const windows1252Decoder = new TextDecoder("windows-1252");
const gb18030Decoder = new TextDecoder("gb18030");

const collator = new Intl.Collator(undefined, {
  usage: "sort",
  sensitivity: "base",
  numeric: true,
});

const extension = (value: string): string => path.extname(value).slice(1).toLowerCase();
const pathKey = (value: string): string => {
  const resolved = path.resolve(value);
  return isWin ? resolved.toLowerCase() : resolved;
};

const isWithin = (root: string, candidate: string): boolean => {
  const base = pathKey(root);
  const target = pathKey(candidate);
  if (base === target) return true;
  const relative = path.relative(base, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const configuredRoots = (): string[] =>
  [...new Set(store.get("library.scanDirs").map((value) => path.resolve(value)))].sort((a, b) =>
    collator.compare(a, b),
  );

/** 将 Folder 逻辑路径限制在已配置音乐根目录；不 realpath，保持 symlink 的 root-relative 身份。 */
export const resolveFolderPath = (input: string): { path: string; root: string } => {
  const candidate = path.resolve(input.trim());
  const root = configuredRoots()
    .filter((item) => isWithin(item, candidate))
    .sort((a, b) => b.length - a.length)[0];
  if (!root) throw new Error("FOLDER_PATH_OUTSIDE_LIBRARY_ROOT");
  return { path: candidate, root };
};

const assertResolvedRealPath = async (resolved: {
  path: string;
  root: string;
}): Promise<string> => {
  const [realRoot, realTarget] = await Promise.all([
    fs.realpath(resolved.root),
    fs.realpath(resolved.path),
  ]);
  if (!isWithin(realRoot, realTarget)) throw new Error("FOLDER_PATH_OUTSIDE_LIBRARY_ROOT");
  return realRoot;
};

const existsAsDirectory = async (value: string): Promise<boolean> => {
  try {
    return (await fs.stat(value)).isDirectory();
  } catch {
    return false;
  }
};

export const listFolderRoots = async (): Promise<FolderRootEntry[]> => {
  const pins = new Set(store.get("library.pinnedFolders").map(pathKey));
  return Promise.all(
    configuredRoots().map(async (root) => ({
      name: path.basename(root) || root,
      path: root,
      available: await existsAsDirectory(root),
      pinned: pins.has(pathKey(root)),
    })),
  );
};

export const listPinnedFolders = async (): Promise<FolderPinEntry[]> => {
  const roots = configuredRoots();
  return Promise.all(
    store.get("library.pinnedFolders").map(async (item) => {
      const candidate = path.resolve(item);
      const root =
        roots
          .filter((configured) => isWithin(configured, candidate))
          .sort((a, b) => b.length - a.length)[0] ?? null;
      let available = false;
      if (root !== null && (await existsAsDirectory(candidate))) {
        try {
          await assertResolvedRealPath({ path: candidate, root });
          available = true;
        } catch {
          available = false;
        }
      }
      return {
        name: path.basename(candidate) || candidate,
        path: candidate,
        root,
        available,
      };
    }),
  );
};

export const authorizeFolderPath = async (input: string): Promise<{ path: string; root: string }> => {
  const resolved = resolveFolderPath(input);
  await assertResolvedRealPath(resolved);
  return resolved;
};

export const pinFolder = async (input: string): Promise<FolderPinEntry[]> => {
  const resolved = resolveFolderPath(input);
  if (!(await existsAsDirectory(resolved.path))) throw new Error("FOLDER_DIRECTORY_NOT_FOUND");
  await assertResolvedRealPath(resolved);
  const current = store.get("library.pinnedFolders");
  if (!current.some((item) => pathKey(item) === pathKey(resolved.path))) {
    store.set("library.pinnedFolders", [...current, resolved.path]);
    publishCoreControlEvent({
      type: "folderPinsChanged",
      data: { paths: store.get("library.pinnedFolders") },
    });
  }
  return listPinnedFolders();
};

export const unpinFolder = async (input: string): Promise<FolderPinEntry[]> => {
  const candidate = path.resolve(input);
  const previous = store.get("library.pinnedFolders");
  const next = previous.filter((item) => pathKey(item) !== pathKey(candidate));
  store.set("library.pinnedFolders", next);
  if (next.length !== previous.length) {
    publishCoreControlEvent({ type: "folderPinsChanged", data: { paths: next } });
  }
  return listPinnedFolders();
};

export const removePinsUnderRoot = (root: string): void => {
  const previous = store.get("library.pinnedFolders");
  const next = previous.filter((item) => !isWithin(root, item));
  store.set("library.pinnedFolders", next);
  if (next.length !== previous.length) {
    publishCoreControlEvent({ type: "folderPinsChanged", data: { paths: next } });
  }
};

type PhysicalEntry = {
  name: string;
  path: string;
  type: "directory" | "file";
  size: number;
  mtime: number;
};

const statPhysicalEntry = async (
  parent: string,
  entry: Dirent,
  realRoot?: string,
): Promise<PhysicalEntry | null> => {
  const child = path.join(parent, entry.name);
  try {
    if (entry.isDirectory()) {
      const stat = await fs.stat(child);
      return { name: entry.name, path: child, type: "directory", size: 0, mtime: stat.mtimeMs };
    }
    if (entry.isFile()) {
      const stat = await fs.stat(child);
      return { name: entry.name, path: child, type: "file", size: stat.size, mtime: stat.mtimeMs };
    }
    if (!entry.isSymbolicLink()) return null;
    if (realRoot) {
      const realTarget = await fs.realpath(child);
      if (!isWithin(realRoot, realTarget)) return null;
    }
    const stat = await fs.stat(child);
    if (stat.isDirectory()) {
      return { name: entry.name, path: child, type: "directory", size: 0, mtime: stat.mtimeMs };
    }
    if (stat.isFile()) {
      return { name: entry.name, path: child, type: "file", size: stat.size, mtime: stat.mtimeMs };
    }
    return null;
  } catch {
    return null;
  }
};

const listPhysicalEntries = async (
  directory: string,
  realRoot?: string,
): Promise<PhysicalEntry[]> => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(entries.map((entry) => statPhysicalEntry(directory, entry, realRoot)))
  ).filter((entry): entry is PhysicalEntry => entry !== null);
};

const materialType = (filePath: string): FolderMaterialType | null => {
  const ext = extension(filePath);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  return null;
};

const readPrefix = async (filePath: string, length = 32): Promise<Buffer> => {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

const hasPrefix = (buffer: Buffer, bytes: number[]): boolean =>
  buffer.length >= bytes.length && bytes.every((byte, index) => buffer[index] === byte);

const looksLikeText = (buffer: Buffer): boolean => {
  if (buffer.length === 0) return true;
  // UTF-16 BOM 文本允许大量 NUL；其余 NUL 基本可判定为二进制。
  if (hasPrefix(buffer, [0xff, 0xfe]) || hasPrefix(buffer, [0xfe, 0xff])) return true;
  let control = 0;
  for (const byte of buffer) {
    if (byte === 0) return false;
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c) {
      control++;
    }
  }
  return control / buffer.length <= 0.02;
};

/**
 * 附属文本在 UTF/BOM 之外兼顾常见 Windows rip log。
 * 大量成对 GBK/GB18030 高位字节时优先中文编码，否则回退 Windows-1252。
 */
const decodeMaterialText = (buffer: Buffer): string => {
  if (buffer.length === 0) return "";
  if (
    hasPrefix(buffer, [0xef, 0xbb, 0xbf]) ||
    hasPrefix(buffer, [0xff, 0xfe]) ||
    hasPrefix(buffer, [0xfe, 0xff])
  ) {
    return decodeAuto(buffer);
  }
  try {
    return strictUtf8Decoder.decode(buffer);
  } catch {
    let highBytes = 0;
    let gbPairs = 0;
    for (let index = 0; index < buffer.length; index++) {
      const lead = buffer[index]!;
      if (lead < 0x80) continue;
      highBytes++;
      const trail = buffer[index + 1];
      if (
        lead >= 0x81 &&
        lead <= 0xfe &&
        trail != null &&
        trail >= 0x40 &&
        trail <= 0xfe &&
        trail !== 0x7f
      ) {
        gbPairs++;
        if (trail >= 0x80) highBytes++;
        index++;
      }
    }
    if (gbPairs >= 2 && gbPairs * 2 >= Math.max(1, highBytes * 0.6)) {
      return gb18030Decoder.decode(buffer);
    }
    return windows1252Decoder.decode(buffer);
  }
};

const verifyMaterialSignature = async (
  filePath: string,
  type: FolderMaterialType,
): Promise<void> => {
  const prefix = await readPrefix(filePath);
  const ext = extension(filePath);
  let valid = true;
  if (type === "pdf") valid = prefix.subarray(0, 5).toString("ascii") === "%PDF-";
  else if (type === "image") {
    valid =
      ext === "jpg" || ext === "jpeg"
        ? hasPrefix(prefix, [0xff, 0xd8, 0xff])
        : ext === "png"
          ? hasPrefix(prefix, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
          : ext === "gif"
            ? prefix.subarray(0, 6).toString("ascii") === "GIF87a" ||
              prefix.subarray(0, 6).toString("ascii") === "GIF89a"
            : ext === "webp"
              ? prefix.subarray(0, 4).toString("ascii") === "RIFF" &&
                prefix.subarray(8, 12).toString("ascii") === "WEBP"
              : false;
  } else {
    valid = looksLikeText(prefix);
  }
  if (!valid) throw new Error("FOLDER_MATERIAL_CONTENT_MISMATCH");
};

const isOrdinaryAudio = (filePath: string): boolean =>
  ORDINARY_AUDIO_EXTENSIONS.has(extension(filePath));

const transientTrackId = (identity: string): string =>
  createHash("sha256").update(identity).digest("hex").slice(0, 16);

const upsertToTrack = (item: UpsertTrack): Track => ({
  id: item.id,
  source: "local",
  path: item.path,
  cuePath: item.cuePath,
  cueAudioPath: item.cueAudioPath,
  cueStartMs: item.cueStartMs,
  cueEndMs: item.cueEndMs,
  cueStartFrame75: item.cueStartFrame75,
  cueEndFrame75: item.cueEndFrame75,
  title: item.title,
  track: item.track,
  disc: item.disc,
  artists: item.artists,
  album: item.album,
  duration: item.duration,
  cover: item.cover,
  quality: item.codec
    ? {
        codec: item.codec,
        sampleRate: item.sampleRate ?? 0,
        bitRate: item.bitRate ?? 0,
        channels: item.channels ?? 0,
        bitsPerSample: item.bitsPerSample ?? 0,
      }
    : undefined,
  fileSize: item.fileSize,
  mtime: item.mtime,
  ctime: item.ctime,
});

const transientFileTrack = async (filePath: string): Promise<Track> => {
  const stat = await fs.stat(filePath);
  return {
    id: transientTrackId(filePath),
    source: "local",
    path: filePath,
    title: path.basename(filePath, path.extname(filePath)),
    artists: [],
    duration: 0,
    fileSize: stat.size,
    mtime: stat.mtimeMs,
    ctime: stat.ctimeMs,
  };
};

const canonicalForExactFile = (tracks: Track[], filePath: string): Track | null =>
  tracks.find(
    (track) =>
      !track.cuePath &&
      !sacdIsoPathFromVirtual(track.path) &&
      track.path != null &&
      pathKey(track.path) === pathKey(filePath),
  ) ?? null;

const sameMtime = (trackMtime: number | undefined, physicalMtime: number): boolean =>
  trackMtime != null && Math.trunc(trackMtime) === Math.trunc(physicalMtime);

const canonicalFileIsFresh = (
  track: Track | null,
  physical: Pick<PhysicalEntry, "size" | "mtime">,
): track is Track =>
  track != null &&
  sameMtime(track.mtime, physical.mtime) &&
  (track.fileSize == null || track.fileSize === physical.size);

const cueTracksFor = (tracks: Track[], cuePath: string): Track[] =>
  tracks
    .filter((track) => track.cuePath != null && pathKey(track.cuePath) === pathKey(cuePath))
    .sort(compareTracks);

const sacdTracksFor = (tracks: Track[], isoPath: string): Track[] =>
  tracks
    .filter((track) => {
      const source = sacdIsoPathFromVirtual(track.path);
      return source != null && pathKey(source) === pathKey(isoPath);
    })
    .sort(compareTracks);

const compareTracks = (a: Track, b: Track): number => {
  const disc = (a.disc ?? 1) - (b.disc ?? 1);
  if (disc !== 0) return disc;
  if (a.track != null || b.track != null) {
    const track = (a.track ?? Number.MAX_SAFE_INTEGER) - (b.track ?? Number.MAX_SAFE_INTEGER);
    if (track !== 0) return track;
  }
  const cue = (a.cueStartMs ?? 0) - (b.cueStartMs ?? 0);
  if (cue !== 0) return cue;
  return collator.compare(a.path ?? a.title, b.path ?? b.title);
};

const inspectCueContainer = async (
  cuePath: string,
): Promise<{ backingPath: string; trackCount: number } | null> => {
  try {
    const stat = await fs.stat(cuePath);
    if (stat.size > MAX_CUE_BYTES) return null;
    const content = await readFileAutoEncoding(cuePath);
    const inspection = inspectCueSheet(content, cuePath);
    if (!inspection) return null;
    await assertResolvedRealPath(resolveFolderPath(inspection.audioPath));
    const audioStat = await fs.stat(inspection.audioPath);
    if (!audioStat.isFile() || !isOrdinaryAudio(inspection.audioPath)) return null;
    return {
      backingPath: path.resolve(inspection.audioPath),
      trackCount: inspection.indexedTrackCount,
    };
  } catch {
    return null;
  }
};

const entryRank = (entry: FolderBrowseEntry): number => {
  if (entry.kind === "directory") return 0;
  if (entry.kind === "material") return 2;
  return 1;
};

const compareExactPaths = (a: FolderBrowseEntry, b: FolderBrowseEntry): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

const compareNamesAndPaths = (a: FolderBrowseEntry, b: FolderBrowseEntry): number => {
  const name = collator.compare(a.name, b.name);
  return name !== 0 ? name : compareExactPaths(a, b);
};

const orderedCompare = (value: number, order: FolderBrowseOrder): number =>
  value === 0 || order === "asc" ? value : -value;

const validTrackPosition = (entry: FolderBrowseEntry): { disc: number; track: number } | null => {
  if (
    entry.kind !== "track" ||
    !Number.isInteger(entry.track.track) ||
    (entry.track.track ?? 0) <= 0
  ) {
    return null;
  }
  const disc =
    Number.isInteger(entry.track.disc) && (entry.track.disc ?? 0) > 0 ? entry.track.disc! : 1;
  return { disc, track: entry.track.track! };
};

const compareBrowseEntries = (
  a: FolderBrowseEntry,
  b: FolderBrowseEntry,
  sort: FolderBrowseSort,
  order: FolderBrowseOrder,
): number => {
  const rank = entryRank(a) - entryRank(b);
  if (rank !== 0) return rank;

  if (sort === "name") {
    const name = orderedCompare(collator.compare(a.name, b.name), order);
    return name !== 0 ? name : compareExactPaths(a, b);
  }

  if (sort === "mtime") {
    const mtime = orderedCompare(a.mtime - b.mtime, order);
    return mtime !== 0 ? mtime : compareNamesAndPaths(a, b);
  }

  // 曲目排序只作用于媒体组；目录、资料和未知轨号媒体始终保持名称升序。
  if (entryRank(a) !== 1) return compareNamesAndPaths(a, b);
  const aTrack = validTrackPosition(a);
  const bTrack = validTrackPosition(b);
  if (aTrack && !bTrack) return -1;
  if (!aTrack && bTrack) return 1;
  if (!aTrack || !bTrack) return compareNamesAndPaths(a, b);
  const disc = orderedCompare(aTrack.disc - bTrack.disc, order);
  if (disc !== 0) return disc;
  const track = orderedCompare(aTrack.track - bTrack.track, order);
  return track !== 0 ? track : compareNamesAndPaths(a, b);
};

const normalizeBrowseFilter = (value?: string): string => value?.trim().toLocaleLowerCase() ?? "";

const matchesBrowseFilter = (entry: FolderBrowseEntry, filter: string): boolean => {
  if (!filter) return true;
  const values = [entry.name];
  if (entry.kind === "track") {
    values.push(entry.track.title);
    if (entry.track.album?.name) values.push(entry.track.album.name);
    values.push(...entry.track.artists.map((artist) => artist.name));
  }
  return values.some((value) => value.toLocaleLowerCase().includes(filter));
};

type BrowseCursor = {
  offset: number;
  directory: string;
  directoryMtime: number;
  filter: string;
  sort: FolderBrowseSort;
  order: FolderBrowseOrder;
  signature: string;
  libraryRevision: number;
};

const createBrowseResultSignature = (
  entries: FolderBrowseEntry[],
  sort: FolderBrowseSort,
): string => {
  const hash = createHash("sha256");
  for (const entry of entries) {
    const position = sort === "track" ? validTrackPosition(entry) : null;
    hash.update(
      JSON.stringify([
        entry.kind,
        entry.path,
        entry.name,
        entry.mtime,
        sort === "mtime" ? entry.mtime : sort === "name" ? entry.name : position,
      ]),
    );
    hash.update("\n");
  }
  return hash.digest("base64url");
};

const encodeBrowseCursor = (cursor: BrowseCursor): string =>
  Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");

const decodeBrowseCursor = (cursor: string | undefined): BrowseCursor | null => {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<
      Record<keyof BrowseCursor, unknown>
    >;
    if (
      !Number.isInteger(value.offset) ||
      typeof value.directory !== "string" ||
      typeof value.directoryMtime !== "number" ||
      typeof value.filter !== "string" ||
      (value.sort !== "name" && value.sort !== "mtime" && value.sort !== "track") ||
      (value.order !== "asc" && value.order !== "desc") ||
      typeof value.signature !== "string" ||
      !Number.isInteger(value.libraryRevision)
    ) {
      return null;
    }
    return {
      offset: Math.max(0, Number(value.offset)),
      directory: value.directory,
      directoryMtime: value.directoryMtime,
      filter: value.filter,
      sort: value.sort,
      order: value.order,
      signature: value.signature,
      libraryRevision: Number(value.libraryRevision),
    };
  } catch {
    return null;
  }
};

export const browseFolder = async (
  input: string,
  cursor?: string,
  requestedLimit = DEFAULT_BROWSE_LIMIT,
  focusPath?: string,
  filter?: string,
  sort: FolderBrowseSort = "name",
  order: FolderBrowseOrder = "asc",
): Promise<FolderBrowsePage> => {
  const resolved = resolveFolderPath(input);
  let directoryStat;
  try {
    directoryStat = await fs.stat(resolved.path);
  } catch {
    return {
      path: resolved.path,
      root: resolved.root,
      parent:
        pathKey(resolved.path) === pathKey(resolved.root) ? null : path.dirname(resolved.path),
      unavailable: true,
      counts: { directories: 0, media: 0, materials: 0, total: 0 },
      entries: [],
    };
  }
  if (!directoryStat.isDirectory()) throw new Error("FOLDER_DIRECTORY_NOT_FOUND");
  const realRoot = await assertResolvedRealPath(resolved);

  const parsedCursor = decodeBrowseCursor(cursor);
  if (cursor && !parsedCursor) throw new Error("FOLDER_CURSOR_INVALID");
  const normalizedFilter = normalizeBrowseFilter(filter);
  if (
    parsedCursor &&
    (parsedCursor.directory !== pathKey(resolved.path) ||
      parsedCursor.filter !== normalizedFilter ||
      parsedCursor.sort !== sort ||
      parsedCursor.order !== order)
  ) {
    throw new Error("FOLDER_CURSOR_INVALID");
  }
  if (
    parsedCursor &&
    (Math.abs(parsedCursor.directoryMtime - directoryStat.mtimeMs) > 0.5 ||
      parsedCursor.libraryRevision !== getLibraryRevision())
  ) {
    throw new Error("FOLDER_CURSOR_STALE");
  }

  const physical = await listPhysicalEntries(resolved.path, realRoot);
  const files = physical.filter((entry) => entry.type === "file");
  const mediaPaths = files
    .filter((entry) => {
      const ext = extension(entry.path);
      return isOrdinaryAudio(entry.path) || ext === "cue" || ext === "iso";
    })
    .map((entry) => entry.path);
  const canonical = getTracksByPhysicalPaths(mediaPaths);

  // CUE backing audio 在浏览层即可通过 FILE 行确认，无需 metadata probe。
  const cueInspections = new Map<string, { backingPath: string; trackCount: number }>();
  const cueBackings = new Set<string>();
  for (const entry of files.filter((item) => extension(item.path) === "cue")) {
    const inspection = await inspectCueContainer(entry.path);
    if (!inspection) continue;
    cueInspections.set(pathKey(entry.path), inspection);
    cueBackings.add(pathKey(inspection.backingPath));
  }

  const entries: FolderBrowseEntry[] = [];
  for (const entry of physical) {
    if (entry.type === "directory") {
      entries.push({ kind: "directory", name: entry.name, path: entry.path, mtime: entry.mtime });
      continue;
    }
    const ext = extension(entry.path);
    if (ext === "cue") {
      const tracks = cueTracksFor(canonical, entry.path);
      const inspection = cueInspections.get(pathKey(entry.path));
      entries.push({
        kind: "cue",
        name: entry.name,
        path: entry.path,
        size: entry.size,
        mtime: entry.mtime,
        trackCount: tracks.length || inspection?.trackCount || undefined,
      });
      continue;
    }
    if (ext === "iso") {
      const tracks = sacdTracksFor(canonical, entry.path);
      entries.push({
        kind: "sacd",
        name: entry.name,
        path: entry.path,
        size: entry.size,
        mtime: entry.mtime,
        trackCount: tracks.length || undefined,
      });
      continue;
    }
    if (isOrdinaryAudio(entry.path)) {
      if (cueBackings.has(pathKey(entry.path))) continue;
      const track = canonicalForExactFile(canonical, entry.path);
      if (canonicalFileIsFresh(track, entry)) {
        entries.push({
          kind: "track",
          name: entry.name,
          path: entry.path,
          size: entry.size,
          mtime: entry.mtime,
          track,
        });
      } else {
        entries.push({
          kind: "file",
          name: entry.name,
          path: entry.path,
          size: entry.size,
          mtime: entry.mtime,
        });
      }
      continue;
    }
    const kind = materialType(entry.path);
    if (kind) {
      try {
        await verifyMaterialSignature(entry.path, kind);
        entries.push({
          kind: "material",
          materialType: kind,
          name: entry.name,
          path: entry.path,
          size: entry.size,
          mtime: entry.mtime,
        });
      } catch {
        // 扩展名白名单不是内容信任边界；伪装/损坏的二进制文件不进入 Folder 视图。
      }
    }
  }

  const filteredEntries = entries.filter((entry) => matchesBrowseFilter(entry, normalizedFilter));
  filteredEntries.sort((a, b) => compareBrowseEntries(a, b, sort, order));
  const resultSignature = createBrowseResultSignature(filteredEntries, sort);
  if (parsedCursor && parsedCursor.signature !== resultSignature) {
    throw new Error("FOLDER_CURSOR_STALE");
  }
  const counts = filteredEntries.reduce(
    (result, entry) => {
      if (entry.kind === "directory") result.directories++;
      else if (entry.kind === "material") result.materials++;
      else result.media++;
      result.total++;
      return result;
    },
    { directories: 0, media: 0, materials: 0, total: 0 },
  );
  const limit = Math.max(
    1,
    Math.min(MAX_BROWSE_LIMIT, Math.trunc(requestedLimit) || DEFAULT_BROWSE_LIMIT),
  );
  const requestedFocus = focusPath?.trim() ? path.resolve(focusPath) : "";
  const focusIndex =
    !parsedCursor && requestedFocus
      ? filteredEntries.findIndex((entry) => pathKey(entry.path) === pathKey(requestedFocus))
      : -1;
  const offset =
    parsedCursor?.offset ?? (focusIndex >= 0 ? Math.floor(focusIndex / limit) * limit : 0);
  const pageEntries = filteredEntries.slice(offset, offset + limit);
  const nextOffset = offset + pageEntries.length;
  const cursorBase = {
    directory: pathKey(resolved.path),
    directoryMtime: directoryStat.mtimeMs,
    filter: normalizedFilter,
    sort,
    order,
    signature: resultSignature,
    libraryRevision: getLibraryRevision(),
  };
  return {
    path: resolved.path,
    root: resolved.root,
    parent: pathKey(resolved.path) === pathKey(resolved.root) ? null : path.dirname(resolved.path),
    unavailable: false,
    counts,
    entries: pageEntries,
    previousCursor:
      offset > 0
        ? encodeBrowseCursor({ ...cursorBase, offset: Math.max(0, offset - limit) })
        : undefined,
    nextCursor:
      nextOffset < filteredEntries.length
        ? encodeBrowseCursor({ ...cursorBase, offset: nextOffset })
        : undefined,
  };
};

const containerCanonicalTracks = (containerPath: string, tracks: Track[]): Track[] => {
  const ext = extension(containerPath);
  if (ext === "cue") return cueTracksFor(tracks, containerPath);
  if (ext === "iso") return sacdTracksFor(tracks, containerPath);
  return [];
};

const probeCueTracks = async (cuePath: string): Promise<Track[]> => {
  const stat = await fs.stat(cuePath);
  if (stat.size > MAX_CUE_BYTES) throw new Error("FOLDER_CUE_TOO_LARGE");
  const content = await readFileAutoEncoding(cuePath);
  const audioPath = getCueAudioPath(content, cuePath);
  if (!audioPath) throw new Error("FOLDER_CUE_UNSUPPORTED");
  await assertResolvedRealPath(resolveFolderPath(audioPath));
  const canonical = getTracksByPhysicalPaths([audioPath]);
  const audioTrack = canonicalForExactFile(canonical, audioPath);
  const metadata = audioTrack
    ? null
    : await getEngine().probeScannedTrack(audioPath, getCoverCacheDir());
  const duration = audioTrack?.duration ?? Math.round((metadata?.duration ?? 0) * 1000);
  const cueTracks = parseCueSheet(content, cuePath, duration);
  if (cueTracks.length === 0) throw new Error("FOLDER_CUE_EMPTY");
  const audioArtists = audioTrack?.artists ?? parseArtists(metadata?.artist ?? "");
  const audioAlbum = audioTrack?.album ?? parseAlbum(metadata?.album ?? "");
  const cover = audioTrack?.cover ?? toCacheUrl(metadata?.cover);
  const quality =
    audioTrack?.quality ??
    (metadata
      ? {
          codec: metadata.codec,
          sampleRate: metadata.sampleRate,
          bitRate: metadata.bitRate,
          channels: metadata.channels,
          bitsPerSample: metadata.bitsPerSample,
        }
      : undefined);

  return cueTracks.map((item) => {
    const album = item.album
      ? { ...item.album, year: item.album.year ?? audioAlbum?.year }
      : audioAlbum
        ? { ...audioAlbum }
        : undefined;
    if (album) {
      album.id = createLocalAlbumId(album.name, cuePath);
      if (!album.artist && audioAlbum?.artist) album.artist = audioAlbum.artist;
    }
    return {
      id: transientTrackId(item.path),
      source: "local",
      path: item.path,
      cuePath: item.cuePath,
      cueAudioPath: path.resolve(audioPath),
      cueStartMs: item.cueStartMs,
      cueEndMs: item.cueEndMs,
      cueStartFrame75: item.cueStartFrame75,
      cueEndFrame75: item.cueEndFrame75,
      title: item.title,
      artists: item.artists.length > 0 ? item.artists : audioArtists,
      album,
      track: item.track,
      disc: audioTrack?.disc ?? metadata?.disc ?? inferDiscNumberFromPath(audioPath),
      duration: item.duration,
      cover,
      quality,
      fileSize: audioTrack?.fileSize ?? metadata?.fileSize,
      mtime: stat.mtimeMs,
      ctime: stat.ctimeMs,
    } satisfies Track;
  });
};

const probeSacdTracks = async (isoPath: string): Promise<Track[]> => {
  const scanned = await getEngine().probeSacdTracks(isoPath);
  if (scanned.length === 0) throw new Error("FOLDER_SACD_EMPTY");
  return scanned.map((item) => upsertToTrack(scannedToUpsert(item))).sort(compareTracks);
};

export const openFolderContainer = async (input: string): Promise<FolderContainerResult> => {
  const resolved = resolveFolderPath(input);
  const containerPath = resolved.path;
  const ext = extension(containerPath);
  if (ext !== "cue" && ext !== "iso") throw new Error("FOLDER_CONTAINER_UNSUPPORTED");
  const stat = await fs.stat(containerPath);
  if (!stat.isFile()) throw new Error("FOLDER_CONTAINER_NOT_FOUND");
  await assertResolvedRealPath(resolved);

  const canonical = containerCanonicalTracks(
    containerPath,
    getTracksByPhysicalPaths([containerPath]),
  );
  const canonicalFresh =
    canonical.length > 0 &&
    canonical.every((track) =>
      ext === "cue"
        ? sameMtime(track.mtime, stat.mtimeMs)
        : sameMtime(track.mtime, stat.mtimeMs) &&
          (track.fileSize == null || track.fileSize === stat.size),
    );
  if (canonicalFresh) {
    return {
      kind: ext === "cue" ? "cue" : "sacd",
      path: containerPath,
      tracks: canonical,
      canonical: true,
    };
  }
  const tracks =
    ext === "cue" ? await probeCueTracks(containerPath) : await probeSacdTracks(containerPath);
  return { kind: ext === "cue" ? "cue" : "sacd", path: containerPath, tracks, canonical: false };
};

const canonicalizeOrdinary = async (filePath: string): Promise<Track> => {
  const existing = canonicalForExactFile(getTracksByPhysicalPaths([filePath]), filePath);
  const stat = await fs.stat(filePath);
  if (
    canonicalFileIsFresh(existing, {
      size: stat.size,
      mtime: stat.mtimeMs,
    })
  ) {
    return existing;
  }
  const scanned = await getEngine().probeScannedTrack(filePath, getCoverCacheDir());
  const record = scannedToUpsert(scanned);
  upsertTracks([record]);
  return upsertToTrack(record);
};

const canonicalizeContainer = async (containerPath: string): Promise<Track[]> => {
  const opened = await openFolderContainer(containerPath);
  if (opened.canonical) return opened.tracks;

  const containerStat = await fs.stat(containerPath);
  const records: UpsertTrack[] = opened.tracks.map((track) => ({
    id: track.id,
    path: track.path!,
    cuePath: track.cuePath,
    cueAudioPath: track.cueAudioPath,
    cueStartMs: track.cueStartMs,
    cueEndMs: track.cueEndMs,
    cueStartFrame75: track.cueStartFrame75,
    cueEndFrame75: track.cueEndFrame75,
    title: track.title,
    track: track.track,
    disc: track.disc,
    artists: track.artists,
    album: track.album,
    duration: track.duration,
    cover: track.cover,
    codec: track.quality?.codec,
    sampleRate: track.quality?.sampleRate,
    bitRate: track.quality?.bitRate,
    channels: track.quality?.channels,
    bitsPerSample: track.quality?.bitsPerSample,
    fileSize: track.fileSize ?? containerStat.size,
    mtime: containerStat.mtimeMs,
    ctime: containerStat.ctimeMs,
  }));
  upsertTracks(records);
  return records.map(upsertToTrack).sort(compareTracks);
};

type ResolveActionOptions = { recursive: boolean; canonicalize: boolean };

const resolveDirectoryAction = async (
  directory: string,
  options: ResolveActionOptions,
  realRoot: string,
  visitedRealDirs: Set<string>,
  failures: string[],
): Promise<Track[]> => {
  let real: string;
  try {
    real = await fs.realpath(directory);
  } catch {
    failures.push(directory);
    return [];
  }
  if (!isWithin(realRoot, real)) {
    failures.push(directory);
    return [];
  }
  const realKey = pathKey(real);
  if (visitedRealDirs.has(realKey)) return [];
  visitedRealDirs.add(realKey);

  let physical: PhysicalEntry[];
  try {
    physical = await listPhysicalEntries(directory, realRoot);
  } catch {
    failures.push(directory);
    return [];
  }
  physical.sort((a, b) => collator.compare(a.name, b.name));
  const files = physical.filter((item) => item.type === "file");
  const mediaPaths = files
    .filter((item) => {
      const ext = extension(item.path);
      return isOrdinaryAudio(item.path) || ext === "cue" || ext === "iso";
    })
    .map((item) => item.path);
  const canonical = getTracksByPhysicalPaths(mediaPaths);

  const backing = new Set<string>();
  const directTracks: Track[] = [];

  for (const file of files.filter((item) => extension(item.path) === "cue")) {
    try {
      const inspection = await inspectCueContainer(file.path);
      const tracks = options.canonicalize
        ? await canonicalizeContainer(file.path)
        : (await openFolderContainer(file.path)).tracks;
      if (inspection && tracks.length > 0) backing.add(pathKey(inspection.backingPath));
      directTracks.push(...tracks);
    } catch {
      // 无效 CUE 不能隐藏 backing audio；音频稍后仍会正常加入。
    }
  }

  for (const file of files.filter((item) => extension(item.path) === "iso")) {
    try {
      const tracks = options.canonicalize
        ? await canonicalizeContainer(file.path)
        : (await openFolderContainer(file.path)).tracks;
      directTracks.push(...tracks);
    } catch {
      failures.push(file.path);
    }
  }

  for (const file of files.filter((item) => isOrdinaryAudio(item.path))) {
    if (backing.has(pathKey(file.path))) continue;
    try {
      const existing = canonicalForExactFile(canonical, file.path);
      const track = options.canonicalize
        ? await canonicalizeOrdinary(file.path)
        : canonicalFileIsFresh(existing, file)
          ? existing
          : await transientFileTrack(file.path);
      directTracks.push(track);
    } catch {
      failures.push(file.path);
    }
  }
  directTracks.sort(compareTracks);

  if (!options.recursive) return directTracks;
  const result = [...directTracks];
  for (const child of physical.filter((item) => item.type === "directory")) {
    result.push(
      ...(await resolveDirectoryAction(child.path, options, realRoot, visitedRealDirs, failures)),
    );
  }
  return result;
};

const resolveActionTracks = async (
  input: string,
  options: ResolveActionOptions,
): Promise<{ tracks: Track[]; failed: string[] }> => {
  const resolved = resolveFolderPath(input);
  const target = resolved.path;
  const stat = await fs.stat(target);
  const realRoot = await assertResolvedRealPath(resolved);
  const failed: string[] = [];
  if (stat.isDirectory()) {
    return {
      tracks: await resolveDirectoryAction(target, options, realRoot, new Set(), failed),
      failed,
    };
  }
  if (!stat.isFile()) throw new Error("FOLDER_TARGET_UNSUPPORTED");
  const ext = extension(target);
  if (ext === "cue" || ext === "iso") {
    try {
      const tracks = options.canonicalize
        ? await canonicalizeContainer(target)
        : (await openFolderContainer(target)).tracks;
      return { tracks, failed };
    } catch {
      return { tracks: [], failed: [target] };
    }
  }
  if (!isOrdinaryAudio(target)) throw new Error("FOLDER_TARGET_UNSUPPORTED");
  try {
    const targetStat = await fs.stat(target);
    const canonical = canonicalForExactFile(getTracksByPhysicalPaths([target]), target);
    return {
      tracks: [
        options.canonicalize
          ? await canonicalizeOrdinary(target)
          : canonicalFileIsFresh(canonical, {
                size: targetStat.size,
                mtime: targetStat.mtimeMs,
              })
            ? canonical
            : await transientFileTrack(target),
      ],
      failed,
    };
  } catch {
    return { tracks: [], failed: [target] };
  }
};

/** Folder 播放动作的纯解析阶段；供动作组合与验证复用，不修改队列。 */
export const resolveFolderPlaybackTracks = async (
  input: string,
  recursive = true,
): Promise<{ tracks: Track[]; failed: string[] }> =>
  resolveActionTracks(input, { recursive, canonicalize: false });

const queueItems = (tracks: Track[]): PlaybackQueueItem[] => tracks.map((track) => ({ track }));

export const runFolderAction = async (
  mode: "play" | "shuffle" | "play-next" | "queue",
  input: string,
  recursive = true,
): Promise<FolderActionResult> => {
  const resolved = await resolveFolderPlaybackTracks(input, recursive);
  const items = queueItems(resolved.tracks);
  if (items.length === 0) return { count: 0, failed: resolved.failed };
  if (mode === "play") await replaceQueue(items, 0, true);
  else if (mode === "shuffle") {
    const startIndex = Math.floor(Math.random() * items.length);
    await replaceQueue(items, startIndex, false, false);
    if (getPlaybackSession().shuffle !== "on") setShuffle("on");
    await selectIndex(0, true, true);
  } else if (mode === "queue") appendQueue(items);
  else {
    const session = getPlaybackSession();
    insertQueue(items, Math.max(0, session.index + 1));
  }
  return { count: items.length, failed: resolved.failed };
};

const resolveFolderBatchTargets = async (
  targets: FolderBatchTarget[],
  canonicalize: boolean,
): Promise<{ tracks: Track[]; failed: string[] }> => {
  const tracks: Track[] = [];
  const failed: string[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    try {
      let resolvedTracks: Track[];
      if (target.kind === "path") {
        const resolved = await resolveActionTracks(target.path, {
          recursive: false,
          canonicalize,
        });
        resolvedTracks = resolved.tracks;
        failed.push(...resolved.failed);
      } else {
        const containerTracks = canonicalize
          ? await canonicalizeContainer(target.containerPath)
          : (await openFolderContainer(target.containerPath)).tracks;
        const track = containerTracks.find((item) => item.id === target.trackId);
        if (!track) {
          failed.push(`${target.containerPath}#${target.trackId}`);
          continue;
        }
        resolvedTracks = [track];
      }
      for (const track of resolvedTracks) {
        if (seen.has(track.id)) continue;
        seen.add(track.id);
        tracks.push(track);
      }
    } catch {
      failed.push(
        target.kind === "path"
          ? target.path
          : `${target.containerPath}#${target.trackId}`,
      );
    }
  }
  return { tracks, failed };
};

export const runFolderBatchAction = async (
  mode: "play" | "play-next" | "queue",
  targets: FolderBatchTarget[],
): Promise<FolderActionResult> => {
  const resolved = await resolveFolderBatchTargets(targets, false);
  const items = queueItems(resolved.tracks);
  if (items.length === 0) return { count: 0, failed: resolved.failed };
  if (mode === "play") await replaceQueue(items, 0, true);
  else if (mode === "queue") appendQueue(items);
  else {
    const session = getPlaybackSession();
    insertQueue(items, Math.max(0, session.index + 1));
  }
  return { count: items.length, failed: resolved.failed };
};

export const addFolderToPlaylist = async (
  playlistId: string,
  input: string,
  recursive = true,
): Promise<{ count: number; failed: string[]; added: number }> => {
  const resolved = await resolveActionTracks(input, { recursive, canonicalize: true });
  if (resolved.tracks.length > 0) publishLibraryRevision();
  const added = addPlaylistTracks(
    playlistId,
    resolved.tracks.map((track) => track.id),
  );
  return { count: resolved.tracks.length, failed: resolved.failed, added };
};

export const addContainerTrackToPlaylist = async (
  playlistId: string,
  containerPath: string,
  trackId: string,
): Promise<{ count: number; failed: string[]; added: number }> => {
  const canonical = await canonicalizeContainer(containerPath);
  publishLibraryRevision();
  const track = canonical.find((item) => item.id === trackId);
  if (!track) throw new Error("FOLDER_CONTAINER_TRACK_NOT_FOUND");
  const added = addPlaylistTracks(playlistId, [track.id]);
  return { count: 1, failed: [], added };
};

export const addFolderBatchToPlaylist = async (
  playlistId: string,
  targets: FolderBatchTarget[],
): Promise<{ count: number; failed: string[]; added: number }> => {
  const resolved = await resolveFolderBatchTargets(targets, true);
  if (resolved.tracks.length > 0) publishLibraryRevision();
  const added = addPlaylistTracks(
    playlistId,
    resolved.tracks.map((track) => track.id),
  );
  return { count: resolved.tracks.length, failed: resolved.failed, added };
};

export const resolveTrackFolderLocation = (track: Track): FolderNavigationTarget => {
  const container = localTrackContainerPath(track);
  if (!container) throw new Error("FOLDER_TRACK_HAS_NO_LOCAL_PATH");
  resolveFolderPath(container);
  if (track.cuePath) {
    return {
      path: path.dirname(track.cuePath),
      containerPath: path.resolve(track.cuePath),
      focusTrackId: track.id,
    };
  }
  const iso = sacdIsoPathFromVirtual(track.path);
  if (iso) {
    return {
      path: path.dirname(iso),
      containerPath: path.resolve(iso),
      focusTrackId: track.id,
    };
  }
  return {
    path: path.dirname(container),
    focusTrackId: track.id,
    focusPath: container,
  };
};

const searchCursorOffset = (cursor?: string): number => {
  if (!cursor) return 0;
  const value = Number(cursor);
  if (!Number.isInteger(value) || value < 0) throw new Error("FOLDER_SEARCH_CURSOR_INVALID");
  return value;
};

export const searchFolders = async (
  query: string,
  cursor?: string,
  requestedLimit = 100,
  signal?: AbortSignal,
): Promise<FolderSearchPage> => {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return { data: [] };
  const offset = searchCursorOffset(cursor);
  const limit = Math.max(1, Math.min(200, Math.trunc(requestedLimit) || 100));
  const targetCount = offset + limit + 1;
  const matches: FolderSearchResult[] = [];
  const visitedRealDirs = new Set<string>();
  let visited = 0;
  let truncated = false;

  const walk = async (directory: string, root: string, realRoot: string): Promise<void> => {
    if (matches.length >= targetCount || truncated || signal?.aborted) return;
    let real: string;
    try {
      real = await fs.realpath(directory);
    } catch {
      return;
    }
    if (!isWithin(realRoot, real)) return;
    const key = pathKey(real);
    if (visitedRealDirs.has(key)) return;
    visitedRealDirs.add(key);
    let items: PhysicalEntry[];
    try {
      items = await listPhysicalEntries(directory, realRoot);
    } catch {
      return;
    }
    items.sort((a, b) => collator.compare(a.name, b.name));
    for (const item of items) {
      if (signal?.aborted) return;
      visited++;
      if (visited > MAX_SEARCH_VISITS) {
        truncated = true;
        return;
      }
      const supportedFile =
        item.type === "file" &&
        (isOrdinaryAudio(item.path) ||
          extension(item.path) === "cue" ||
          extension(item.path) === "iso" ||
          materialType(item.path) !== null);
      if (
        (item.type === "directory" || supportedFile) &&
        item.name.toLocaleLowerCase().includes(normalized)
      ) {
        matches.push({
          kind: item.type === "directory" ? "directory" : "file",
          name: item.name,
          path: item.path,
          parent: path.dirname(item.path),
          root,
        });
        if (matches.length >= targetCount) return;
      }
      if (item.type === "directory") await walk(item.path, root, realRoot);
      if (matches.length >= targetCount || truncated) return;
    }
  };

  for (const root of configuredRoots()) {
    let realRoot: string;
    try {
      realRoot = await fs.realpath(root);
    } catch {
      continue;
    }
    await walk(root, root, realRoot);
    if (matches.length >= targetCount || truncated || signal?.aborted) break;
  }
  if (signal?.aborted) throw new Error("FOLDER_SEARCH_CANCELLED");

  const data = matches.slice(offset, offset + limit);
  // truncated 表示本次搜索触及遍历预算，不伪造无法推进的 offset cursor。
  // 只有已经实际拿到下一条结果时才暴露 nextCursor，避免稀疏匹配下空页死循环。
  const hasMore = matches.length > offset + data.length;
  return {
    data,
    nextCursor: hasMore ? String(offset + data.length) : undefined,
    truncated: truncated || undefined,
  };
};

const assertMaterial = async (
  input: string,
): Promise<{
  entry: FolderMaterialEntry;
  mime: string;
}> => {
  const resolved = resolveFolderPath(input);
  const filePath = resolved.path;
  const type = materialType(filePath);
  if (!type) throw new Error("FOLDER_MATERIAL_UNSUPPORTED");
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error("FOLDER_MATERIAL_NOT_FOUND");
  await assertResolvedRealPath(resolved);
  await verifyMaterialSignature(filePath, type);
  const ext = extension(filePath);
  const mime =
    type === "pdf"
      ? "application/pdf"
      : type === "text"
        ? "text/plain; charset=utf-8"
        : ext === "png"
          ? "image/png"
          : ext === "webp"
            ? "image/webp"
            : ext === "gif"
              ? "image/gif"
              : "image/jpeg";
  return {
    entry: {
      kind: "material",
      materialType: type,
      name: path.basename(filePath),
      path: filePath,
      size: stat.size,
      mtime: stat.mtimeMs,
    },
    mime,
  };
};

export const getFolderMaterial = assertMaterial;

export const readFolderTextMaterial = async (input: string): Promise<FolderTextMaterial> => {
  const material = await assertMaterial(input);
  if (material.entry.materialType !== "text") throw new Error("FOLDER_MATERIAL_NOT_TEXT");
  const handle = await fs.open(material.entry.path, "r");
  try {
    const length = Math.min(material.entry.size, MAX_TEXT_PREVIEW_BYTES);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    const bytes = buffer.subarray(0, bytesRead);
    if (!looksLikeText(bytes)) throw new Error("FOLDER_MATERIAL_TEXT_UNDECODABLE");
    return {
      text: decodeMaterialText(bytes),
      truncated: material.entry.size > MAX_TEXT_PREVIEW_BYTES,
      size: material.entry.size,
    };
  } finally {
    await handle.close();
  }
};

const makeImageThumbnailFromPath = async (sourcePath: string): Promise<Buffer> => {
  const stat = await fs.stat(sourcePath);
  if (!stat.isFile()) throw new Error("FOLDER_MATERIAL_NOT_FOUND");
  if (stat.size > MAX_THUMBNAIL_SOURCE_BYTES) {
    throw new Error("FOLDER_MATERIAL_IMAGE_TOO_LARGE");
  }
  const key = `${pathKey(sourcePath)}\0${stat.mtimeMs}\0${stat.size}`;
  const cached = thumbnailCache.get(key);
  if (cached) {
    thumbnailCache.delete(key);
    thumbnailCache.set(key, cached);
    return cached;
  }
  const bytes = await fs.readFile(sourcePath);
  const thumbnail = await getEngine().makeImageThumbnail(bytes, 320);
  thumbnailCache.set(key, thumbnail);
  while (thumbnailCache.size > MAX_THUMBNAIL_CACHE_ITEMS) {
    const oldest = thumbnailCache.keys().next().value as string | undefined;
    if (!oldest) break;
    thumbnailCache.delete(oldest);
  }
  return thumbnail;
};

export const makeFolderMaterialThumbnail = async (input: string): Promise<Buffer> => {
  const material = await assertMaterial(input);
  if (material.entry.materialType !== "image") throw new Error("FOLDER_MATERIAL_NOT_IMAGE");
  return makeImageThumbnailFromPath(material.entry.path);
};

const folderDirectoryArtworkPath = async (
  physical: PhysicalEntry[],
): Promise<string | null> => {
  const images = physical.filter(
    (item) => item.type === "file" && materialType(item.path) === "image",
  );
  for (const preferred of DIRECTORY_ARTWORK_NAMES) {
    const found = images.find(
      (item) => path.basename(item.name, path.extname(item.name)).toLocaleLowerCase() === preferred,
    );
    if (!found) continue;
    try {
      await verifyMaterialSignature(found.path, "image");
      return found.path;
    } catch {
      // 损坏或伪装图片继续尝试下一个候选。
    }
  }
  if (images.length === 1) {
    try {
      await verifyMaterialSignature(images[0]!.path, "image");
      return images[0]!.path;
    } catch {
      return null;
    }
  }
  return null;
};

const folderCanonicalCoverPath = (physical: PhysicalEntry[]): string | null => {
  const mediaPaths = physical
    .filter((item) => {
      if (item.type !== "file") return false;
      const ext = extension(item.path);
      return isOrdinaryAudio(item.path) || ext === "cue" || ext === "iso";
    })
    .map((item) => item.path);
  if (mediaPaths.length === 0) return null;
  const covers = getTracksByPhysicalPaths(mediaPaths)
    .map((track) => track.cover)
    .filter((cover): cover is string => !!cover);
  if (covers.length === 0) return null;
  const first = covers[0]!;
  return covers.every((cover) => cover === first) ? first : null;
};

export const resolveFolderDirectoryArtworkPath = async (input: string): Promise<string | null> => {
  const resolved = resolveFolderPath(input);
  const directory = resolved.path;
  const stat = await fs.stat(directory);
  if (!stat.isDirectory()) throw new Error("FOLDER_DIRECTORY_NOT_FOUND");
  const realRoot = await assertResolvedRealPath(resolved);

  const physical = await listPhysicalEntries(directory, realRoot);
  const artwork = await folderDirectoryArtworkPath(physical);
  if (artwork) return artwork;

  const canonicalCover = folderCanonicalCoverPath(physical);
  if (!canonicalCover) return null;
  const cachedCoverPath = fromCacheUrl(canonicalCover);
  if (!cachedCoverPath) return null;
  try {
    return (await fs.stat(cachedCoverPath)).isFile() ? cachedCoverPath : null;
  } catch {
    const filename = canonicalCover.startsWith("cache://covers/")
      ? canonicalCover.slice("cache://covers/".length)
      : "";
    if (!filename || !(await repairMissingCoverCache(filename))) return null;
    try {
      return (await fs.stat(cachedCoverPath)).isFile() ? cachedCoverPath : null;
    } catch {
      return null;
    }
  }
};

export const makeFolderDirectoryThumbnail = async (input: string): Promise<Buffer | null> => {
  const sourcePath = await resolveFolderDirectoryArtworkPath(input);
  return sourcePath ? makeImageThumbnailFromPath(sourcePath) : null;
};
