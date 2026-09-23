/**
 * KG 精选歌单（移动站歌单频道）
 *
 * 端点：http://m.kugou.com/plist/index&json=true
 *
 * 说明：`mobilecdn` 通道的 `/api/v3/special/recommend`、`/api/v3/special/list` 均返回
 * "Access Deny"（该通道只放行了 rank / special 详情 / search / album/list 等少数路径），
 * 而移动站 `m.kugou.com` 的歌单频道 JSON 稳定可用：实测总量 600、每页 30、支持 page 翻页
 * （pagesize 参数不生效，接口固定 30 条/页）。
 *
 * params:
 * - page   页码，从 1 开始，默认 1
 * - limit  截断条数（用于首页书架），不传则返回整页
 */

import { decodeName, fillCover } from "../core/config";
import { kgRequest } from "../core/request";
import type { KGModule } from "../core/types";

interface RawSpecial {
  specialid?: number | string;
  specialname?: string;
  imgurl?: string;
  intro?: string;
  playcount?: number;
  songcount?: number;
  username?: string;
  nickname?: string;
  publishtime?: string;
}

interface PlistIndexResp {
  plist?: {
    list?: {
      total?: number;
      has_next?: number;
      info?: RawSpecial[];
    };
  };
}

const plistSquare: KGModule = async (params) => {
  const page = Number(params.page ?? 1) || 1;
  const whole = typeof params.limit === "number" ? Number(params.limit) : undefined;

  const body = await kgRequest<PlistIndexResp>(
    `http://m.kugou.com/plist/index&json=true&page=${page}`,
  );
  const list = body.plist?.list ?? {};

  const all = (list.info ?? [])
    .map((item) => {
      const id = item.specialid != null ? String(item.specialid) : "";
      const name = decodeName(item.specialname ?? "");
      if (!id || !name) return null;
      return {
        id,
        name,
        // imgurl 是带 {size} 的模板，由 fillCover 替换并统一升级 https
        cover: fillCover(item.imgurl, 300) ?? "",
        coverOriginal: fillCover(item.imgurl, 480) ?? "",
        creator: decodeName(item.username ?? item.nickname ?? ""),
        description: decodeName(item.intro ?? ""),
        playCount: item.playcount ?? 0,
        trackCount: item.songcount ?? 0,
        publishTime: item.publishtime ?? "",
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const total = list.total ?? all.length;
  const playlists = whole && whole > 0 ? all.slice(0, whole) : all;
  return { code: 200, page, total, hasNext: Boolean(list.has_next), playlists };
};

export default plistSquare;
