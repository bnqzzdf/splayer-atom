/**
 * KG 排行榜（榜单目录 + 榜单歌曲）
 *
 * 接口（均走 mobilecdn 公开通道，与 playlist 模块同源）：
 * - 榜单目录：GET http://mobilecdn.kugou.com/api/v3/rank/list
 * - 榜单信息：GET http://mobilecdn.kugou.com/api/v3/rank/info
 * - 榜单歌曲：GET http://mobilecdn.kugou.com/api/v3/rank/song
 *
 * 说明：酷狗 App 自身把 56 个榜单按 classify 字段分成 5 组，但接口不下发组名，
 * 下面的 KG_RANK_CLASSIFY_NAMES 是按实测各组成员归纳出的名称，不是接口返回的原文。
 */

import { decodeName, fillCover } from "../core/config";
import { kgRequest } from "../core/request";
import type { KGModule, KGSong, Quality } from "../core/types";

/** classify → 组名（依据实际成员归纳：1 热歌/飙升/新歌，2 地区，3 年代与人群，4 海外，5 曲风） */
const KG_RANK_CLASSIFY_NAMES: Record<number, string> = {
  1: "热门榜",
  2: "地区榜",
  3: "特色榜",
  4: "全球榜",
  5: "曲风榜",
};

const RANK_LIST_URL =
  "http://mobilecdn.kugou.com/api/v3/rank/list?version=9108&plat=0&showtype=2&parentid=0&apiver=2&area_code=1&withsong=1&newstyle=1&format=json";

interface RawRankEntry {
  rankid?: number | string;
  rankname?: string;
  img_cover?: string;
  img_9?: string;
  banner_9?: string;
  classify?: number;
  ranktype?: number;
  update_frequency?: string;
  format?: string;
  play_times?: number;
  intro?: string;
}

interface RawRankSong {
  hash?: string;
  audio_id?: number;
  album_audio_id?: number;
  album_id?: string | number;
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

/** 榜单歌曲 → 应用层 KGSong（rank/song 用 authors[]，与 special/song 的 singername 不同） */
const normalizeRankSong = (raw: RawRankSong, fallbackCover?: string): KGSong => {
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
    album: "",
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

/** 榜单目录条目 */
interface KGRankItem {
  id: string;
  name: string;
  cover: string;
  playCount: number;
  updateFrequency: string;
  rankType: number;
  description: string;
}

/** 榜单目录：按 classify 分组 */
const rankList: KGModule = async (params) => {
  const body = await kgRequest<{ data?: { total?: number; info?: RawRankEntry[] } }>(RANK_LIST_URL);
  const rawList = body.data?.info ?? [];
  const filter = params.classify != null ? Number(params.classify) : null;

  const buckets = new Map<number, KGRankItem[]>();
  for (const raw of rawList) {
    const classify = raw.classify ?? 0;
    if (filter !== null && classify !== filter) continue;
    const id = raw.rankid != null ? String(raw.rankid) : "";
    const name = decodeName(raw.rankname ?? "");
    if (!id || !name) continue;
    const list = buckets.get(classify) ?? [];
    list.push({
      id,
      name,
      // 封面模板里的 {size} 由 fillCover 负责替换，并统一升级为 https
      cover: fillCover(raw.img_cover || raw.img_9 || raw.banner_9, 300) ?? "",
      playCount: raw.play_times ?? 0,
      updateFrequency: raw.update_frequency ?? "",
      rankType: raw.ranktype ?? 0,
      description: decodeName(raw.intro ?? ""),
    });
    buckets.set(classify, list);
  }

  const groups = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([classify, items]) => ({
      id: String(classify),
      name: KG_RANK_CLASSIFY_NAMES[classify] ?? `分类 ${classify}`,
      items,
    }));

  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  return { code: 200, total, groups };
};

/** 榜单详情：榜单信息 + 歌曲列表 */
const rankDetail: KGModule = async (params) => {
  const rankid = String(params.rankid ?? params.id ?? "").trim();
  if (!rankid) return { code: 400, message: "rankid required" };

  const limit = Number(params.limit ?? 100) || 100;
  const page = Number(params.page ?? 1) || 1;

  const [infoRes, songsRes] = await Promise.all([
    kgRequest<{
      data?: { rankid?: number | string; rankname?: string; intro?: string; imgurl?: string };
    }>(
      `http://mobilecdn.kugou.com/api/v3/rank/info?rankid=${encodeURIComponent(rankid)}&format=json`,
    ),
    kgRequest<{ data?: { total?: number; info?: RawRankSong[] } }>(
      `http://mobilecdn.kugou.com/api/v3/rank/song?rankid=${encodeURIComponent(rankid)}&page=${page}&pagesize=${limit}&format=json`,
    ),
  ]);

  const info = infoRes.data ?? {};
  const rawSongs = songsRes.data?.info ?? [];
  const cover = fillCover(info.imgurl, 300);
  const coverOriginal = fillCover(info.imgurl, 480);
  const songs = rawSongs.map((song) => normalizeRankSong(song, info.imgurl));

  return {
    code: 200,
    id: String(info.rankid ?? rankid),
    name: decodeName(info.rankname ?? ""),
    description: decodeName(info.intro ?? ""),
    cover,
    coverOriginal,
    total: songsRes.data?.total ?? songs.length,
    songs,
  };
};

export { rankDetail, rankList };
