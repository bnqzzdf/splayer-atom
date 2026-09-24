/**
 * KG 歌曲归一化
 *
 * 酷狗有几套「歌曲数组」结构，字段名并不统一：
 * - `special/song`（歌单）：用 `singername` + `album_name`
 * - `rank/song`、`m.kugou.com` 首页与 `newsong/index`：用 `authors[]`，没有 `album_name`
 *
 * 本文件负责后一种（`authors[]` 家族）。榜单、新歌首发共用同一份实现，
 * 避免「榜单能播、新歌不能播」这类因字段差异造成的偏差。
 */

import { decodeName, fillCover } from "./config";
import type { KGSong, Quality } from "./types";

/** `authors[]` 家族的原始歌曲结构（rank/song、newsong/index、m.kugou.com 首页通用） */
export interface KGRawAuthorSong {
  hash?: string;
  audio_id?: number;
  album_audio_id?: number;
  album_id?: string | number;
  album_name?: string;
  songname?: string;
  filename?: string;
  duration?: number;
  filesize?: number;
  "320filesize"?: number;
  sqfilesize?: number;
  filesize_high?: number;
  filesize_super?: number;
  hash_high?: string;
  hash_super?: string;
  "320hash"?: string;
  sqhash?: string;
  pay_type?: number;
  privilege?: number;
  authors?: Array<{ author_id?: number | string; author_name?: string }>;
  trans_param?: {
    union_cover?: string;
  };
}

/** 从 `歌手A - 歌名` 形式的 filename 中拆出歌手 */
const artistFromFilename = (filename: string): string => {
  const parts = filename.split(" - ");
  return parts.length > 1 ? decodeName(parts[0].trim()) : "";
};

/** 从 `歌手A - 歌名` 形式的 filename 中拆出歌名 */
const songNameFromFilename = (filename: string): string => {
  const parts = filename.split(" - ");
  return parts.length > 1 ? decodeName(parts.slice(1).join(" - ").trim()) : decodeName(filename);
};

/**
 * `authors[]` 家族歌曲 → 应用层 KGSong
 * @param raw - 酷狗原始歌曲
 * @param fallbackCover - 兜底封面（如所在歌单/榜单的封面）
 * @returns 归一化后的 KGSong
 */
export const normalizeKgAuthorSong = (raw: KGRawAuthorSong, fallbackCover?: string): KGSong => {
  const filename = raw.filename ?? "";
  const authorNames = (raw.authors ?? [])
    .map((author) => decodeName(author.author_name ?? ""))
    .filter(Boolean);
  const artist = authorNames.length ? authorNames.join(" / ") : artistFromFilename(filename);

  const cover = fillCover(raw.trans_param?.union_cover || fallbackCover, 300);
  const coverOriginal = fillCover(raw.trans_param?.union_cover || fallbackCover, 480);
  const interval = raw.duration ?? 0;

  const sizes: Partial<Record<Quality, number>> = {};
  const hashes: Partial<Record<Quality, string>> = {};

  if (raw.filesize && raw.hash) {
    sizes["128k"] = raw.filesize;
    hashes["128k"] = raw.hash;
  }
  // 320k：优先 320 专用字段，回退到 _high 系列
  const hash320 = raw["320hash"] || raw.hash_high;
  const size320 = raw["320filesize"] || raw.filesize_high;
  if (size320 && hash320) {
    sizes["320k"] = size320;
    hashes["320k"] = hash320;
  }
  if (raw.sqfilesize && raw.sqhash) {
    sizes.flac = raw.sqfilesize;
    hashes.flac = raw.sqhash;
  }
  if (raw.filesize_super && raw.hash_super) {
    sizes.flac24bit = raw.filesize_super;
    hashes.flac24bit = raw.hash_super;
  }

  const artists = artist ? artist.split(" / ").map((name) => ({ id: name, name })) : [];

  return {
    id: String(raw.audio_id || raw.hash || ""),
    audioId: raw.audio_id ?? 0,
    albumAudioId: raw.album_audio_id,
    hash: raw.hash ?? "",
    name: songNameFromFilename(filename) || decodeName(raw.songname ?? ""),
    artist,
    artists,
    album: decodeName(raw.album_name ?? ""),
    albumId: raw.album_id ?? "",
    cover,
    coverOriginal,
    interval,
    duration: interval * 1000,
    qualities: Object.keys(hashes) as Quality[],
    hashes,
    sizes,
    pay: {
      payplay: raw.pay_type ?? 0,
      privilege: raw.privilege ?? 0,
    },
  };
};

/**
 * 批量归一化
 * @param songs - 酷狗原始歌曲数组
 * @param fallbackCover - 兜底封面
 * @returns KGSong 数组
 */
export const normalizeKgAuthorSongs = (
  songs: KGRawAuthorSong[] | undefined,
  fallbackCover?: string,
): KGSong[] => (songs ?? []).map((song) => normalizeKgAuthorSong(song, fallbackCover));
