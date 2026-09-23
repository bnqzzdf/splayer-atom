/**
 * 排行榜详情（榜单歌曲列表）
 *
 * 端点：https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg（Web GET，与 song_list 同族）
 *
 * 为什么不走 musicu 的 musicToplist.ToplistInfoServer/GetDetail：
 * 该接口返回的 song[] 只有 songId、**没有 songmid**，而取流（song_url）必须以 songmid
 * 作为文件名基底，缺 mid 会让榜单歌曲全部无法播放。Web 榜单接口直接给出 songmid /
 * strMediaMid / 各档 size，可以完整映射为渲染层的 QMSong。
 *
 * params:
 * - topid   榜单 ID（必填）：26 热歌榜 / 62 飙升榜 / 4 流行指数榜 / 27 新歌榜 等
 * - limit   返回条数，默认 50
 * - offset  偏移量，默认 0
 */

import { QM_HEADERS, formatSingerName } from "../core/config";
import type { QMModule } from "../core/types";

interface ToplistSong {
  songid?: number;
  songmid?: string;
  songname?: string;
  interval?: number;
  singer?: Array<{ name?: string; mid?: string }>;
  albumname?: string;
  albummid?: string;
  strMediaMid?: string;
  pay?: {
    payalbum?: number;
    payplay?: number;
  };
  size128?: number;
  size320?: number;
  sizeape?: number;
  sizeflac?: number;
  sizeogg?: number;
}

interface ToplistInfo {
  ListName?: string;
  info?: string;
  headPic_v12?: string;
  pic_v12?: string;
  MacListPicUrl?: string;
  pic?: string;
  listennum?: number;
}

interface ToplistResp {
  code?: number;
  topinfo?: ToplistInfo;
  date?: string;
  update_time?: string;
  total_song_num?: number;
  songlist?: Array<{ data?: ToplistSong }>;
}

const TOPLIST_URL =
  "https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?page=detail&type=top&format=json&inCharset=utf8&outCharset=utf-8&platform=yqq&needNewCode=0";

const leaderboard: QMModule = async (params) => {
  const topid = String(params.topid ?? params.topId ?? "").trim();
  if (!topid) return { code: 400, message: "topid required" };

  const limit = Number(params.limit ?? 50) || 50;
  const offset = Number(params.offset ?? 0) || 0;

  const url = `${TOPLIST_URL}&topid=${encodeURIComponent(topid)}&song_begin=${offset}&song_num=${limit}`;
  const res = await fetch(url, {
    headers: { ...QM_HEADERS, Referer: "https://y.qq.com/" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`QM 榜单请求失败: HTTP ${res.status}`);

  const text = await res.text();
  const json = text
    .trim()
    .replace(/^jsonCallback\s*\(/, "")
    .replace(/\)\s*;?$/, "");
  const data = JSON.parse(json) as ToplistResp;

  const info = data.topinfo ?? {};
  const songs = (data.songlist ?? [])
    // Web 榜单把歌曲信息放在每一项的 data 字段里；历史上也见过扁平结构，两者都兼容。
    .map((entry) => entry?.data ?? (entry as unknown as ToplistSong))
    .filter((item): item is ToplistSong => Boolean(item?.songmid))
    .map((item) => ({
      id: String(item.songid ?? ""),
      mid: item.songmid ?? "",
      mediaMid: item.strMediaMid ?? "",
      name: item.songname ?? "",
      artist: formatSingerName(item.singer),
      artists: item.singer ?? [],
      album: item.albumname ?? "",
      albumMid: item.albummid ?? "",
      duration: (item.interval ?? 0) * 1000,
      pay: item.pay,
      size128: item.size128 ?? 0,
      size320: item.size320 ?? 0,
      sizeApe: item.sizeape ?? 0,
      sizeFlac: item.sizeflac ?? 0,
      sizeOgg: item.sizeogg ?? 0,
    }));

  return {
    code: 200,
    id: topid,
    name: info.ListName ?? "",
    description: info.info ?? "",
    // 榜单封面顺序：v12 头图 → 方形图 → Mac 列表图 → 旧 pic；接口下发 http，统一升级 https
    cover: (info.headPic_v12 || info.pic_v12 || info.MacListPicUrl || info.pic || "").replace(
      /^http:\/\//,
      "https://",
    ),
    playCount: info.listennum ?? 0,
    updateTime: data.update_time || data.date || "",
    total: data.total_song_num ?? songs.length,
    songs,
  };
};

export default leaderboard;
