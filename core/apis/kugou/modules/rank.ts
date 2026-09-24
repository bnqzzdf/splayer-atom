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
import { normalizeKgAuthorSong, type KGRawAuthorSong } from "../core/song";
import type { KGModule } from "../core/types";

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
    kgRequest<{ data?: { total?: number; info?: KGRawAuthorSong[] } }>(
      `http://mobilecdn.kugou.com/api/v3/rank/song?rankid=${encodeURIComponent(rankid)}&page=${page}&pagesize=${limit}&format=json`,
    ),
  ]);

  const info = infoRes.data ?? {};
  const rawSongs = songsRes.data?.info ?? [];
  const cover = fillCover(info.imgurl, 300);
  const coverOriginal = fillCover(info.imgurl, 480);
  const songs = rawSongs.map((song) => normalizeKgAuthorSong(song, info.imgurl));

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
