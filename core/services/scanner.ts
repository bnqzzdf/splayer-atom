import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { JsScanEvent, JsScannedTrack } from "@splayer/audio-engine";
import type { ScanProgress } from "@shared/types/library";
import { getEngine } from "./engine";
import {
  getAllTracks,
  upsertTracks,
  deleteTracksByPaths,
  getFileRecords,
  getCueTrackPathsByDirs,
  type UpsertTrack,
} from "@main/database";
import { publishCoreControlEvent } from "@main/services/coreControlEvents";
import { fromCacheUrl, toCacheUrl } from "@main/atom/cacheUrl";
import { toMs } from "@main/utils/time";
import { parseArtists, parseAlbum } from "@main/utils/metadata";
import { createLocalAlbumId, inferDiscNumberFromPath } from "@main/utils/localAlbum";
import { getCoverCacheDir, isWin } from "@main/utils/config";
import { libraryLog } from "@main/utils/logger";
import { getCueAudioPath, parseCueSheet, extractCuePath } from "./cue";
import { readFileAutoEncoding } from "@main/utils/encoding";
import { sacdIsoPathFromVirtual } from "@main/utils/localPhysicalSource";
import { publishLibraryRevision } from "@main/services/libraryRevision";

let scanning = false;
let currentScanProgress: ScanProgress = { phase: "done", total: 0, scanned: 0 };
let scanGeneration = 0;
let pendingSacdSyncs: Promise<number>[] = [];

const SACD_PLACEHOLDER_TITLE = /^Track\s*0*\d+$/i;

const isSacdAggregate = (track: JsScannedTrack): boolean =>
  /\.iso$/i.test(track.path) && /^sacd_/i.test(track.codec);

const publishScanProgress = (progress: ScanProgress): void => {
  currentScanProgress = progress;
  publishCoreControlEvent({ type: "libraryScanProgress", data: progress });
};

/** 路径比较键，Windows 下保持大小写不敏感 */
const pathKey = (value: string): string => {
  const resolved = path.resolve(value);
  return isWin ? resolved.toLowerCase() : resolved;
};

/** 判断物理路径是否位于本轮扫描范围；避免局部扫描把范围外记录误判为删除。 */
const pathInScanDirs = (value: string, dirs: string[]): boolean => {
  const candidate = pathKey(value);
  return dirs.some((dir) => {
    const root = pathKey(dir);
    if (candidate === root) return true;
    const relative = path.relative(root, candidate);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  });
};

/**
 * Rust 扫描/探测结果 → 数据库 Upsert 记录
 * id 由文件路径哈希生成，标签编辑回灌与扫描共用此规则
 */
export const scannedToUpsert = (track: JsScannedTrack): UpsertTrack => {
  const id = createHash("sha256").update(track.path).digest("hex").slice(0, 16);
  const album = parseAlbum(track.album ?? "");
  if (album) {
    album.id = createLocalAlbumId(album.name, track.path);
    if (track.albumArtist?.trim()) album.artist = track.albumArtist.trim();
    if (track.year) album.year = track.year;
  }
  return {
    id,
    path: track.path,
    title: track.title || track.path.split(/[/\\]/).pop() || track.path,
    track: track.track,
    disc: track.disc ?? inferDiscNumberFromPath(track.path),
    artists: parseArtists(track.artist ?? ""),
    album,
    duration: toMs(track.duration),
    cover: toCacheUrl(track.cover),
    codec: track.codec,
    sampleRate: track.sampleRate,
    bitRate: track.bitRate,
    channels: track.channels,
    bitsPerSample: track.bitsPerSample,
    fileSize: track.fileSize,
    mtime: track.mtime,
    ctime: track.ctime,
  };
};

/**
 * 扫描器仍以物理 ISO 为文件粒度；Atom 在这里把其展开为曲库虚拟分轨。
 * 只在完整解析成功后替换旧记录，临时 I/O/解析失败不会清空既有 SACD。
 */
const syncSacdTracks = async (aggregate: JsScannedTrack, generation: number): Promise<number> => {
  const isoPath = aggregate.path;
  try {
    const scanned = await getEngine().probeSacdTracks(isoPath);
    if (!scanning || generation !== scanGeneration) return 0;
    if (scanned.length === 0) {
      libraryLog.warn(`解析 SACD 分轨为空，保留既有记录 [${isoPath}]`);
      return 0;
    }

    const isoKey = pathKey(isoPath);
    const existingPaths = getAllTracks()
      .filter((track) => {
        if (!track.path) return false;
        const source =
          sacdIsoPathFromVirtual(track.path) ?? (/\.iso$/i.test(track.path) ? track.path : null);
        return source != null && pathKey(source) === isoKey;
      })
      .map((track) => track.path!);

    const normalized = scanned.map((track) => ({
      ...track,
      cover: track.cover ?? aggregate.cover,
      fileSize: aggregate.fileSize || track.fileSize,
      mtime: aggregate.mtime || track.mtime,
      ctime: aggregate.ctime || track.ctime,
    }));
    const nextPaths = new Set(normalized.map((track) => track.path));
    upsertTracks(normalized.map(scannedToUpsert));

    const stalePaths = existingPaths.filter((trackPath) => !nextPaths.has(trackPath));
    if (stalePaths.length > 0) deleteTracksByPaths(stalePaths);
    return normalized.length;
  } catch (error) {
    libraryLog.warn(`解析 SACD 失败 [${isoPath}]:`, error);
    return 0;
  }
};

/**
 * 向 Rust scanner 投影本轮范围内的全部已有物理文件。
 * existing data 同时承担删除检测，因此 force-rescan 也必须传入；是否跳过未变化文件
 * 由独立的 skipUnchanged 参数决定。
 */
export const buildScanExistingData = (dirs: string[]) => {
  // 旧虚拟分轨已经有正确 path/mtime，但标题可能仍是 Track NN。这样的 ISO 必须
  // 再 probe 一次，让修正后的 SACDTTxt 元数据覆盖占位标题；成功后下次恢复正常增量跳过。
  const sacdMetadataRefresh = new Set(
    getAllTracks().flatMap((track) => {
      const isoPath = sacdIsoPathFromVirtual(track.path);
      return isoPath && SACD_PLACEHOLDER_TITLE.test(track.title ?? "") ? [pathKey(isoPath)] : [];
    }),
  );

  const physical = new Map<
    string,
    ReturnType<typeof getFileRecords>[number] & { forceProbe?: boolean }
  >();
  for (const record of getFileRecords()) {
    const virtualIso = sacdIsoPathFromVirtual(record.path);
    if (virtualIso) {
      const key = pathKey(virtualIso);
      if (!physical.has(key)) {
        physical.set(key, {
          ...record,
          path: virtualIso,
          forceProbe: sacdMetadataRefresh.has(key),
        });
      } else if (sacdMetadataRefresh.has(key)) {
        physical.get(key)!.forceProbe = true;
      }
      continue;
    }
    physical.set(pathKey(record.path), {
      ...record,
      forceProbe: /\.iso$/i.test(record.path),
    });
  }

  return [...physical.values()].flatMap(({ cover, ...record }) => {
    if (!pathInScanDirs(record.path, dirs)) return [];
    const coverPath = fromCacheUrl(cover);
    return [
      {
        ...record,
        coverPath,
        forceProbe:
          record.forceProbe === true || (cover?.startsWith("cache://") === true && !coverPath),
      },
    ];
  });
};

/** deleted physical ISO 必须同时展开到数据库里的全部 virtual Track path。 */
const expandRemovedPaths = (removedPaths: string[]): string[] => {
  if (removedPaths.length === 0) return [];
  const result = new Set(removedPaths);
  const removedIsoKeys = new Set(
    removedPaths.filter((value) => /\.iso$/i.test(value)).map((value) => pathKey(value)),
  );
  if (removedIsoKeys.size === 0) return [...result];
  for (const track of getAllTracks()) {
    const isoPath = sacdIsoPathFromVirtual(track.path);
    if (isoPath && removedIsoKeys.has(pathKey(isoPath))) result.add(track.path!);
  }
  return [...result];
};

/** 同步 CUE 虚拟曲目到曲库 */
const syncCueTracks = async (
  cueFiles: string[],
  dirs: string[],
  unavailableDirs: string[] = [],
  incremental = true,
): Promise<number> => {
  const allTracks = getAllTracks();
  // 真实音频文件
  const audioByPath = new Map(
    allTracks.flatMap((track) =>
      !track.cuePath && track.path ? [[pathKey(track.path), track] as const] : [],
    ),
  );
  // 跳过未变化的 CUE
  const existingByCue = new Map<string, { mtime: number; paths: string[] }>();
  for (const track of allTracks) {
    if (!track.cuePath || !track.path) continue;
    const key = pathKey(track.cuePath);
    const group = existingByCue.get(key);
    if (group) group.paths.push(track.path);
    else existingByCue.set(key, { mtime: track.mtime ?? -1, paths: [track.path] });
  }

  const upserts: UpsertTrack[] = [];
  const nextPaths = new Set<string>();

  for (const cuePath of cueFiles) {
    try {
      const cueStat = await fs.stat(cuePath);
      const existing = existingByCue.get(pathKey(cuePath));
      // .cue 未变化
      if (incremental && existing && existing.mtime === cueStat.mtimeMs) {
        for (const trackPath of existing.paths) nextPaths.add(trackPath);
        continue;
      }
      const content = await readFileAutoEncoding(cuePath);
      const audioPath = getCueAudioPath(content, cuePath);
      if (!audioPath) continue;
      const audio = audioByPath.get(pathKey(audioPath));
      if (!audio || audio.duration <= 0) continue;
      const cueTracks = parseCueSheet(content, cuePath, audio.duration);
      for (const cueTrack of cueTracks) {
        const id = createHash("sha256").update(cueTrack.path).digest("hex").slice(0, 16);
        const album = cueTrack.album
          ? { ...cueTrack.album, year: cueTrack.album.year ?? audio.album?.year }
          : audio.album
            ? { ...audio.album }
            : undefined;
        if (album) {
          album.id = createLocalAlbumId(album.name, cuePath);
          if (!album.artist && audio.album?.artist) album.artist = audio.album.artist;
        }
        nextPaths.add(cueTrack.path);
        upserts.push({
          id,
          path: cueTrack.path,
          cuePath: cueTrack.cuePath,
          // 存容器整轨的真实入库路径（而非 CUE FILE 行解析值），保证与容器行 path 精确相等，据此隐藏容器
          cueAudioPath: audio.path,
          cueStartMs: cueTrack.cueStartMs,
          cueEndMs: cueTrack.cueEndMs,
          cueStartFrame75: cueTrack.cueStartFrame75,
          cueEndFrame75: cueTrack.cueEndFrame75,
          title: cueTrack.title,
          track: cueTrack.track,
          disc:
            audio.disc ?? inferDiscNumberFromPath(audio.path) ?? inferDiscNumberFromPath(cuePath),
          artists: cueTrack.artists,
          album,
          duration: cueTrack.duration,
          cover: audio.cover,
          codec: audio.quality?.codec,
          sampleRate: audio.quality?.sampleRate,
          bitRate: audio.quality?.bitRate,
          channels: audio.quality?.channels,
          bitsPerSample: audio.quality?.bitsPerSample,
          fileSize: audio.fileSize ?? cueStat.size,
          mtime: cueStat.mtimeMs,
          ctime: cueStat.ctimeMs,
        });
      }
    } catch (error) {
      libraryLog.warn(`解析 CUE 失败 [${cuePath}]:`, error);
      // 解析失败时保留既有分轨，避免误删
      const existing = existingByCue.get(pathKey(cuePath));
      if (existing) {
        for (const trackPath of existing.paths) nextPaths.add(trackPath);
      }
    }
  }

  if (upserts.length > 0) upsertTracks(upserts);
  if (upserts.length > 0) publishLibraryRevision();
  const stalePaths = getCueTrackPathsByDirs(dirs).filter((trackPath) => {
    if (nextPaths.has(trackPath)) return false;
    // 不可达目录下的分轨不删除：从虚拟路径提取真实 cuePath 做目录判断
    const realCuePath = extractCuePath(trackPath);
    if (!realCuePath) return true;
    return !unavailableDirs.some((dir) => pathInScanDirs(realCuePath, [dir]));
  });
  if (stalePaths.length > 0) deleteTracksByPaths(stalePaths);
  return nextPaths.size;
};

/** 完成 Rust 扫描后的收尾同步 */
const finishScan = async (
  dirs: string[],
  event: JsScanEvent,
  generation: number,
  incremental: boolean,
): Promise<void> => {
  const sacdCounts = await Promise.all(pendingSacdSyncs);
  pendingSacdSyncs = [];
  if (generation !== scanGeneration) return;

  const removedPaths = expandRemovedPaths(event.removedPaths ?? []);
  if (removedPaths.length > 0) {
    deleteTracksByPaths(removedPaths);
    libraryLog.info(`清理 ${removedPaths.length} 个已删除文件/虚拟分轨`);
  }
  const cueCount = await syncCueTracks(
    event.cueFiles ?? [],
    dirs,
    event.unavailableDirs ?? [],
    incremental,
  );
  const sacdCount = sacdCounts.reduce((sum, count) => sum + count, 0);
  scanning = false;
  if (removedPaths.length > 0 || cueCount > 0 || sacdCount > 0) publishLibraryRevision();
  publishScanProgress({
    phase: "done",
    total: event.total,
    scanned: event.scanned,
    scopeDirs: [...dirs],
    incremental,
  });
  libraryLog.info(
    `扫描完成: ${event.scanned}/${event.total} 个文件，CUE 分轨 ${cueCount} 首，SACD 分轨 ${sacdCount} 首`,
  );
};

/** 是否正在扫描 */
export const isScanning = (): boolean => scanning;

/** 当前扫描进度快照，供 Web Control 读取。 */
export const getScanProgress = (): ScanProgress => ({ ...currentScanProgress });

/**
 * 开始扫描
 * @param dirs 扫描目录列表
 * @param incremental 是否增量扫描（跳过未变化的文件）
 */
export const startScan = (dirs: string[], incremental = true): boolean => {
  if (scanning) {
    libraryLog.warn("已有扫描任务进行中，跳过");
    return false;
  }
  if (dirs.length === 0) {
    libraryLog.warn("无扫描目录，跳过");
    return false;
  }

  const normalizedDirs = [...new Set(dirs.map((dir) => path.resolve(dir)))];
  scanning = true;
  const generation = ++scanGeneration;
  pendingSacdSyncs = [];
  currentScanProgress = {
    phase: "scanning",
    total: 0,
    scanned: 0,
    scopeDirs: [...normalizedDirs],
    incremental,
  };
  publishCoreControlEvent({ type: "libraryScanProgress", data: currentScanProgress });
  libraryLog.info(`开始扫描 ${normalizedDirs.length} 个目录 (增量=${incremental})`);

  // existing data 同时用于删除检测；是否跳过未变化文件由最后一个参数独立控制。
  const existingData = buildScanExistingData(normalizedDirs);

  const engine = getEngine();
  engine.scanDirs(
    normalizedDirs,
    (event: JsScanEvent) => {
      switch (event.eventType) {
        case "progress": {
          // 已取消则丢弃滞后批次，避免写回已删除目录的曲目
          if (!scanning) break;
          // 普通文件直接写库；SACD 聚合探测结果由 Atom seam 异步展开成虚拟分轨。
          if (event.tracks && event.tracks.length > 0) {
            const ordinary = event.tracks.filter((track) => !isSacdAggregate(track));
            if (ordinary.length > 0) {
              upsertTracks(ordinary.map(scannedToUpsert));
              publishLibraryRevision();
            }
            for (const track of event.tracks.filter(isSacdAggregate)) {
              pendingSacdSyncs.push(syncSacdTracks(track, generation));
            }
          }
          publishScanProgress({
            phase: "scanning",
            total: event.total,
            scanned: event.scanned,
            current: event.current,
            scopeDirs: [...normalizedDirs],
            incremental,
          });
          break;
        }
        case "done": {
          void finishScan(normalizedDirs, event, generation, incremental).catch((error) => {
            scanning = false;
            libraryLog.error("扫描收尾失败:", error);
            publishScanProgress({
              phase: "done",
              total: event.total,
              scanned: event.scanned,
              scopeDirs: [...normalizedDirs],
              incremental,
            });
          });
          break;
        }
      }
    },
    getCoverCacheDir(),
    existingData,
    incremental,
  );
  return true;
};

/** 取消正在进行的扫描 */
export const cancelScan = (): void => {
  if (!scanning) return;
  const engine = getEngine();
  engine.cancelScan();
  scanning = false;
  ++scanGeneration;
  pendingSacdSyncs = [];
  publishScanProgress({ ...currentScanProgress, phase: "done" });
  libraryLog.info("已发送扫描取消信号");
};
