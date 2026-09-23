/**
 * QM 热门歌单（歌单广场）
 *
 * 端点：https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg（Web GET，与 song_list 同族）
 *
 * 为什么不用 musicu：
 * QQ音乐 App 首页那几个模块（`music.musicHall.MusicHallPlatform`）对普通 HTTP 客户端
 * 一律返回 500005（模块级门禁，与是否登录、ct/cv 版本号无关，实测已确认），
 * `music.playlist.PlayListSquareServer` 等模块则返回 500003（不存在）。
 * 歌单广场这个老 CGI 反而稳定可用，且能直接给出歌单 ID → 详情页已支持。
 *
 * params:
 * - limit       返回条数，默认 30
 * - offset      偏移量，默认 0
 * - categoryId  分类，默认 10000000（全部）
 * - sortId      排序，默认 5（推荐）；2 = 最新
 */

import { QM_HEADERS } from "../core/config";
import type { QMModule } from "../core/types";

interface RawDiss {
  dissid?: string | number;
  dissname?: string;
  imgurl?: string;
  introduction?: string;
  listennum?: number;
  creator?: { name?: string };
}

interface DissSquareResp {
  code?: number;
  data?: {
    sum?: number;
    list?: RawDiss[];
  };
}

const DISS_SQUARE_URL =
  "https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg?picmid=1&rnd=0.1&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0";

const playlistSquare: QMModule = async (params) => {
  const limit = Number(params.limit ?? 30) || 30;
  const offset = Number(params.offset ?? 0) || 0;
  const categoryId = String(params.categoryId ?? "10000000");
  const sortId = String(params.sortId ?? "5");

  const url = `${DISS_SQUARE_URL}&categoryId=${encodeURIComponent(categoryId)}&sortId=${encodeURIComponent(sortId)}&sin=${offset}&ein=${offset + limit - 1}`;
  const res = await fetch(url, {
    headers: { ...QM_HEADERS, Referer: "https://y.qq.com/" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`QM 歌单广场请求失败: HTTP ${res.status}`);

  const text = await res.text();
  const json = text
    .trim()
    .replace(/^jsonCallback\s*\(/, "")
    .replace(/\)\s*;?$/, "");
  const data = JSON.parse(json) as DissSquareResp;

  const playlists = (data.data?.list ?? [])
    .map((item) => {
      const id = item.dissid != null ? String(item.dissid) : "";
      const name = item.dissname ?? "";
      if (!id || !name) return null;
      return {
        id,
        name,
        // 接口下发 http://qpic.y.qq.com/...，统一升级 https 避免混合内容
        cover: (item.imgurl ?? "").replace(/^http:\/\//, "https://"),
        creator: item.creator?.name ?? "",
        description: item.introduction ?? "",
        playCount: item.listennum ?? 0,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return { code: 200, total: data.data?.sum ?? playlists.length, playlists };
};

export default playlistSquare;
