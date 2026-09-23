import path from "node:path";
import type { Track, Artist, Album, AudioQuality } from "@shared/types/player";
import type { AlbumSummary, ArtistSummary } from "@shared/types/library";
import type { LibraryStats } from "@shared/types/stats";
import { createLocalAlbumId, inferDiscNumberFromPath } from "@main/utils/localAlbum";
import { getDb } from "./index";

/** 数据库行类型 */
interface TrackRow {
  id: string;
  path: string;
  cue_path: string | null;
  cue_audio_path: string | null;
  cue_start_ms: number | null;
  cue_end_ms: number | null;
  cue_start_frame75: number | null;
  cue_end_frame75: number | null;
  title: string;
  track?: number;
  disc: number | null;
  artists: string;
  album: string | null;
  duration: number;
  cover: string | null;
  codec: string | null;
  sample_rate: number | null;
  bit_rate: number | null;
  channels: number | null;
  bits_per_sample: number | null;
  file_size: number;
  file_mtime: number | null;
  file_ctime: number | null;
  scanned_at: number;
}

const trackOrder = (prefix = ""): string =>
  `COALESCE(${prefix}disc, 1), ${prefix}track IS NULL, ${prefix}track, COALESCE(${prefix}cue_start_ms, 0), ${prefix}path COLLATE NOCASE`;

const libraryOrder = (prefix = ""): string =>
  `json_extract(${prefix}album, '$.name') IS NULL, COALESCE(json_extract(${prefix}album, '$.name'), '') COLLATE NOCASE, ${trackOrder(prefix)}`;

/** 将数据库行解析为 Track */
const albumPhysicalSource = (row: Pick<TrackRow, "path" | "cue_path" | "cue_audio_path">): string =>
  row.cue_path ?? row.cue_audio_path ?? row.path;

/** 将数据库行解析为 Track，并补齐本地专辑稳定 ID 与旧库的目录碟号 fallback。 */
const rowToTrack = (row: TrackRow): Track => {
  const quality: AudioQuality | undefined =
    row.codec != null
      ? {
          codec: row.codec,
          sampleRate: row.sample_rate ?? 0,
          bitRate: row.bit_rate ?? 0,
          channels: row.channels ?? 0,
          bitsPerSample: row.bits_per_sample ?? 0,
        }
      : undefined;

  const album = row.album ? (JSON.parse(row.album) as Album) : undefined;
  if (album?.name) album.id = createLocalAlbumId(album.name, albumPhysicalSource(row));
  const disc =
    row.disc ??
    inferDiscNumberFromPath(row.cue_audio_path ?? row.cue_path ?? row.path) ??
    inferDiscNumberFromPath(row.cue_path ?? row.path);

  return {
    id: row.id,
    source: "local",
    path: row.path,
    cuePath: row.cue_path ?? undefined,
    cueAudioPath: row.cue_audio_path ?? undefined,
    cueStartMs: row.cue_start_ms ?? undefined,
    cueEndMs: row.cue_end_ms ?? undefined,
    cueStartFrame75: row.cue_start_frame75 ?? undefined,
    cueEndFrame75: row.cue_end_frame75 ?? undefined,
    title: row.title,
    track: row.track ?? undefined,
    disc,
    artists: JSON.parse(row.artists) as Artist[],
    album,
    duration: row.duration,
    cover: row.cover ?? undefined,
    fileSize: row.file_size ?? undefined,
    mtime: row.file_mtime ?? undefined,
    ctime: row.file_ctime ?? undefined,
    quality,
  };
};

/** 查询全部曲目（含被 CUE 引用的容器整轨，供扫描器读取时长/封面等） */
export const getAllTracks = (): Track[] => {
  const rows = getDb()
    .prepare(`SELECT * FROM tracks ORDER BY ${libraryOrder()}`)
    .all() as TrackRow[];
  return rows.map(rowToTrack);
};

/**
 * 按物理文件/容器路径批量解析 canonical Track。
 * 普通文件按 path 命中；CUE 同时匹配 cue_path/cue_audio_path；SACD 虚拟 Track
 * 通过其 `{iso}|Track..` 前缀匹配。
 */
export const getTracksByPhysicalPaths = (paths: string[]): Track[] => {
  const requested = [...new Set(paths.map((value) => path.resolve(value)))];
  if (requested.length === 0) return [];
  const result = new Map<string, Track>();
  const database = getDb();

  for (let start = 0; start < requested.length; start += 200) {
    const chunk = requested.slice(start, start + 200);
    const values = chunk.map(() => "(?)").join(",");
    const rows = database
      .prepare(
        `WITH requested(path) AS (VALUES ${values})
         SELECT DISTINCT t.*
         FROM tracks t
         INNER JOIN requested r
           ON t.path = r.path
           OR t.cue_path = r.path
           OR t.cue_audio_path = r.path
           OR (
             lower(substr(r.path, -4)) = '.iso'
             AND instr(t.path, r.path || '|Track') = 1
           )
         ORDER BY ${trackOrder("t.")}`,
      )
      .all(...chunk) as TrackRow[];
    for (const row of rows) {
      const track = rowToTrack(row);
      result.set(track.id, track);
    }
  }
  return [...result.values()];
};

/**
 * 排除被 CUE 分轨引用的容器整轨文件的 WHERE 片段
 * 容器整轨（如整张原盘 flac）已被虚拟分轨取代，不应在曲库中重复出现
 * @param col - 外层曲目的 path 列（json_each 也有 path 列，带别名时须显式限定）
 */
const excludeCueContainer = (col = "path"): string =>
  `${col} NOT IN (SELECT cue_audio_path FROM tracks WHERE cue_audio_path IS NOT NULL)`;

/** 获取曲目总数（不含 CUE 容器整轨） */
export const getTrackCount = (): number => {
  const row = getDb()
    .prepare(`SELECT COUNT(*) as count FROM tracks WHERE ${excludeCueContainer()}`)
    .get() as { count: number };
  return row.count;
};

/** 随机取一首曲目，库为空时返回 null */
export const getRandomTrack = (): Track | null => {
  const row = getDb()
    .prepare(`SELECT * FROM tracks WHERE ${excludeCueContainer()} ORDER BY RANDOM() LIMIT 1`)
    .get() as TrackRow | undefined;
  return row ? rowToTrack(row) : null;
};

/** 随机取多首曲目 */
export const getRandomTracks = (limit: number): Track[] => {
  const safe = Math.max(0, Math.min(limit | 0, 500));
  if (safe === 0) return [];
  const rows = getDb()
    .prepare(`SELECT * FROM tracks WHERE ${excludeCueContainer()} ORDER BY RANDOM() LIMIT ?`)
    .all(safe) as TrackRow[];
  return rows.map(rowToTrack);
};

/** 用于增量扫描比对的文件记录 */
export interface FileRecord {
  path: string;
  mtime: number;
  size: number;
  cover: string | null;
}

/** 获取所有真实音频文件记录及封面引用，用于增量扫描比对与缓存修复。 */
export const getFileRecords = (): FileRecord[] => {
  return getDb()
    .prepare(
      "SELECT path, COALESCE(file_mtime, 0) as mtime, file_size as size, cover FROM tracks WHERE cue_path IS NULL",
    )
    .all() as FileRecord[];
};

/** 按 canonical cover URL 找一个可重新生成该缓存封面的物理音源。 */
export const getCoverSourcePath = (cover: string): string | null => {
  const row = getDb()
    .prepare(
      `SELECT path, cue_audio_path
       FROM tracks
       WHERE cover = ?
       ORDER BY cue_audio_path IS NOT NULL, scanned_at
       LIMIT 1`,
    )
    .get(cover) as Pick<TrackRow, "path" | "cue_audio_path"> | undefined;
  return row ? (row.cue_audio_path ?? row.path) : null;
};

/** 批量插入/更新的扫描结果 */
export interface UpsertTrack {
  id: string;
  path: string;
  cuePath?: string;
  cueAudioPath?: string;
  cueStartMs?: number;
  cueEndMs?: number;
  cueStartFrame75?: number;
  cueEndFrame75?: number;
  title: string;
  track?: number;
  disc?: number;
  artists: Artist[];
  album?: Album;
  duration: number;
  cover?: string;
  codec?: string;
  sampleRate?: number;
  bitRate?: number;
  channels?: number;
  bitsPerSample?: number;
  fileSize: number;
  mtime: number;
  ctime: number;
}

/** 批量插入/更新曲目（使用事务） */
export const upsertTracks = (tracks: UpsertTrack[]): void => {
  if (tracks.length === 0) return;
  const d = getDb();
  const stmt = d.prepare(`
    INSERT OR REPLACE INTO tracks
      (id, path, cue_path, cue_audio_path, cue_start_ms, cue_end_ms, cue_start_frame75, cue_end_frame75, title, track, disc, artists, album, duration, cover, codec, sample_rate, bit_rate, channels, bits_per_sample, file_size, file_mtime, file_ctime, scanned_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getAddedAt = d.prepare(
    "SELECT scanned_at AS addedAt FROM tracks WHERE id = ? OR path = ? LIMIT 1",
  );
  const now = Date.now();
  const tx = d.transaction(() => {
    for (const t of tracks) {
      const existing = getAddedAt.get(t.id, t.path) as { addedAt: number } | undefined;
      stmt.run(
        t.id,
        t.path,
        t.cuePath ?? null,
        t.cueAudioPath ?? null,
        t.cueStartMs ?? null,
        t.cueEndMs ?? null,
        t.cueStartFrame75 ?? null,
        t.cueEndFrame75 ?? null,
        t.title,
        t.track ?? null,
        t.disc ?? null,
        JSON.stringify(t.artists),
        t.album ? JSON.stringify(t.album) : null,
        t.duration,
        t.cover ?? null,
        t.codec ?? null,
        t.sampleRate ?? null,
        t.bitRate ?? null,
        t.channels ?? null,
        t.bitsPerSample ?? null,
        t.fileSize,
        t.mtime,
        t.ctime,
        existing?.addedAt ?? now,
      );
    }
  });
  tx();
};

/** 查询指定目录下的 CUE 虚拟曲目路径 */
export const getCueTrackPathsByDirs = (dirs: string[]): string[] => {
  if (dirs.length === 0) return [];
  const rows: { path: string }[] = [];
  const stmt = getDb().prepare("SELECT path FROM tracks WHERE cue_path LIKE ? ESCAPE '\\'");
  for (const dir of dirs) {
    const prefix = dir.endsWith("/") || dir.endsWith("\\") ? dir : dir + path.sep;
    const escaped = prefix.replace(/[\\%_]/g, "\\$&");
    rows.push(...(stmt.all(escaped + "%") as { path: string }[]));
  }
  return rows.map((row) => row.path);
};

/** 批量删除曲目（按路径） */
export const deleteTracksByPaths = (paths: string[]): void => {
  if (paths.length === 0) return;
  const d = getDb();
  const removeMemberships = d.prepare(
    `DELETE FROM playlist_tracks
     WHERE playlist_id IN (SELECT id FROM playlists WHERE type = 'local')
       AND track_id IN (
         SELECT id FROM tracks WHERE path = ? OR cue_audio_path = ? OR cue_path = ?
       )`,
  );
  const stmt = d.prepare("DELETE FROM tracks WHERE path = ? OR cue_audio_path = ? OR cue_path = ?");
  const tx = d.transaction(() => {
    for (const p of paths) {
      removeMemberships.run(p, p, p);
      stmt.run(p, p, p);
    }
  });
  tx();
};

/** 模糊搜索曲目（title / artists / album） */
export const searchTracks = (query: string): Track[] => {
  const escaped = query.replace(/[%_\\]/g, "\\$&");
  const pattern = `%${escaped}%`;
  const rows = getDb()
    .prepare(
      `SELECT * FROM tracks WHERE (title LIKE ? ESCAPE '\\' OR artists LIKE ? ESCAPE '\\' OR album LIKE ? ESCAPE '\\') AND ${excludeCueContainer()}`,
    )
    .all(pattern, pattern, pattern) as TrackRow[];
  return rows.map(rowToTrack);
};

/** 删除指定目录下的所有曲目 */
export const deleteTracksByDir = (dir: string): void => {
  const prefix = dir.endsWith("/") || dir.endsWith("\\") ? dir : dir + path.sep;
  const pattern = prefix.replace(/[\\%_]/g, "\\$&") + "%";
  const patterns = [pattern, pattern, pattern];
  const database = getDb();
  database.transaction(() => {
    database
      .prepare(
        `DELETE FROM playlist_tracks
         WHERE playlist_id IN (SELECT id FROM playlists WHERE type = 'local')
           AND track_id IN (
             SELECT id FROM tracks
             WHERE path LIKE ? ESCAPE '\\'
                OR cue_path LIKE ? ESCAPE '\\'
                OR cue_audio_path LIKE ? ESCAPE '\\'
           )`,
      )
      .run(...patterns);
    database
      .prepare(
        "DELETE FROM tracks WHERE path LIKE ? ESCAPE '\\' OR cue_path LIKE ? ESCAPE '\\' OR cue_audio_path LIKE ? ESCAPE '\\'",
      )
      .run(...patterns);
  })();
};

/** 专辑列表 */
export const getAlbumList = (): AlbumSummary[] => {
  const rows = getDb()
    .prepare(
      `SELECT path, cue_path, cue_audio_path, album, artists, cover, scanned_at
       FROM tracks
       WHERE album IS NOT NULL AND json_valid(album)
         AND json_extract(album, '$.name') IS NOT NULL
         AND ${excludeCueContainer()}`,
    )
    .all() as Pick<
    TrackRow,
    "path" | "cue_path" | "cue_audio_path" | "album" | "artists" | "cover" | "scanned_at"
  >[];

  const albums = new Map<
    string,
    {
      id: string;
      name: string;
      cover?: string;
      artists: Map<string, string>;
      trackCount: number;
      year?: number;
      addedAt: number;
    }
  >();
  for (const row of rows) {
    if (!row.album) continue;
    const album = JSON.parse(row.album) as Album;
    if (!album.name) continue;
    const id = createLocalAlbumId(album.name, albumPhysicalSource(row));
    const existing = albums.get(id) ?? {
      id,
      name: album.name,
      cover: undefined,
      artists: new Map<string, string>(),
      trackCount: 0,
      year: undefined,
      addedAt: row.scanned_at,
    };
    if (!existing.cover && row.cover) existing.cover = row.cover;
    existing.trackCount++;
    existing.addedAt = Math.min(existing.addedAt, row.scanned_at);
    if (album.year != null) existing.year = Math.max(existing.year ?? 0, album.year);
    const albumArtists = album.artist
      ? [{ name: album.artist }]
      : (JSON.parse(row.artists) as Artist[]);
    for (const artist of albumArtists) {
      const name = artist.name.trim();
      if (name) existing.artists.set(name.toLocaleLowerCase(), name);
    }
    albums.set(id, existing);
  }
  return [...albums.values()].map(({ artists, ...album }) => ({
    ...album,
    artist: [...artists.values()].join(" / "),
  }));
};

/** 歌手列表 */
export const getArtistList = (): ArtistSummary[] => {
  const rows = getDb()
    .prepare(
      `SELECT
         json_extract(a.value, '$.name') AS name,
         COUNT(DISTINCT t.id) AS trackCount,
         MAX(CASE WHEN t.cover IS NOT NULL THEN t.cover END) AS cover
       FROM tracks t, json_each(t.artists) a
       WHERE json_extract(a.value, '$.name') IS NOT NULL
         AND TRIM(json_extract(a.value, '$.name')) != ''
         AND ${excludeCueContainer("t.path")}
       GROUP BY name`,
    )
    .all() as { name: string; trackCount: number; cover: string | null }[];
  return rows.map((row) => ({
    name: row.name,
    trackCount: row.trackCount,
    cover: row.cover ?? undefined,
  }));
};

const compareAlbumTracks = (a: Track, b: Track): number => {
  const discDiff = (a.disc ?? 1) - (b.disc ?? 1);
  if (discDiff) return discDiff;
  if (a.track == null && b.track != null) return 1;
  if (a.track != null && b.track == null) return -1;
  const trackDiff = (a.track ?? 0) - (b.track ?? 0);
  if (trackDiff) return trackDiff;
  const cueDiff = (a.cueStartMs ?? 0) - (b.cueStartMs ?? 0);
  if (cueDiff) return cueDiff;
  return (a.path ?? "").localeCompare(b.path ?? "", undefined, { numeric: true });
};

/**
 * 按本地专辑 ID 获取全部曲目。albumName 用于把候选集缩到同名专辑；
 * 老链接仍可把专辑名直接作为第一个参数使用。
 */
export const getAlbumTracks = (albumId: string, albumName?: string): Track[] => {
  const requestedName = albumName?.trim();
  const queryByName = (name: string): TrackRow[] =>
    getDb()
      .prepare(
        `SELECT * FROM tracks
         WHERE json_valid(album) AND json_extract(album, '$.name') = ?
           AND ${excludeCueContainer()}`,
      )
      .all(name) as TrackRow[];

  if (requestedName) {
    const matched = queryByName(requestedName)
      .map(rowToTrack)
      .filter((track) => track.album?.id === albumId)
      .sort(compareAlbumTracks);
    if (matched.length > 0) return matched;
  }

  // 兼容旧的 /collection/local/album/<album-name> 链接。
  return queryByName(albumId).map(rowToTrack).sort(compareAlbumTracks);
};

/** 按歌手名获取全部曲目 */
export const getArtistTracks = (artistName: string): Track[] => {
  const rows = getDb()
    .prepare(
      `SELECT * FROM tracks t
       WHERE EXISTS (
         SELECT 1 FROM json_each(t.artists) a
         WHERE LOWER(json_extract(a.value, '$.name')) = LOWER(?)
       ) AND ${excludeCueContainer("t.path")}
       ORDER BY ${libraryOrder("t.")}`,
    )
    .all(artistName) as TrackRow[];
  return rows.map(rowToTrack);
};

/** 音乐库统计概览：数量、总时长/大小与格式分布 */
export const getLibraryStats = (): LibraryStats => {
  const d = getDb();
  const aggregate = d
    .prepare(
      `SELECT COUNT(*) AS trackCount,
              COALESCE(SUM(duration), 0) AS totalDurationMs,
              COALESCE(SUM(file_size), 0) AS totalFileSize
       FROM tracks
       WHERE ${excludeCueContainer()}`,
    )
    .get() as { trackCount: number; totalDurationMs: number; totalFileSize: number };

  const albumCount = getAlbumList().length;

  const artistRow = d
    .prepare(
      `SELECT COUNT(DISTINCT json_extract(a.value, '$.name')) AS count
       FROM tracks t, json_each(t.artists) a
       WHERE json_extract(a.value, '$.name') IS NOT NULL
         AND TRIM(json_extract(a.value, '$.name')) != ''
         AND ${excludeCueContainer("t.path")}`,
    )
    .get() as { count: number };

  const codecs = d
    .prepare(
      `SELECT COALESCE(codec, '') AS codec, COUNT(*) AS count
       FROM tracks
       WHERE ${excludeCueContainer()}
       GROUP BY codec
       ORDER BY count DESC, codec`,
    )
    .all() as { codec: string; count: number }[];

  return {
    trackCount: aggregate.trackCount,
    albumCount,
    artistCount: artistRow.count,
    totalDurationMs: aggregate.totalDurationMs,
    totalFileSize: aggregate.totalFileSize,
    codecs,
  };
};

/** 按 ID 批量获取曲目 */
export const getTracksByIds = (ids: string[]): Track[] => {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(`SELECT * FROM tracks WHERE id IN (${placeholders})`)
    .all(...ids) as TrackRow[];
  return rows.map(rowToTrack);
};
