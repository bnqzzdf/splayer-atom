/**
 * 歌手分类列表（无需登录）
 *
 * 端点：`/api/v1/artist/list`（weapi）。这就是网易「歌手」页左侧那套分类的数据源：
 * 按地区 × 类型筛歌手，并支持分页——平台页的「热门歌手」地区标签与「更多」靠它。
 *
 * **路径必须带 `v1`**：实测 `/api/artist/list`（不带 v1）会静默忽略 `area` 与 `type`，
 * 五个地区取值全部返回同一份热门列表（首字母 `initial` 与 `offset` 却仍然生效，
 * 所以很容易误判成"参数名写错了"）。带 v1 后 area=96 得到 Justin Bieber / The Weeknd、
 * area=8 得到 初音ミク / 米津玄師、area=16 得到 BIGBANG / EXO，才真正区分开。
 *
 * 为什么不复用 `top_artists`（`/api/artist/top`）：那个接口只支持 limit/offset，
 * 没有地区维度，且它是「热门」这一个固定视图。
 *
 * params:
 * - area    地区：-1 全部（默认）/ 7 华语 / 96 欧美 / 8 日本 / 16 韩国
 * - type    类型：-1 全部（默认）/ 1 男歌手 / 2 女歌手 / 3 乐队组合
 * - initial 首字母：默认 -1（不筛）
 * - limit   每页条数，默认 30
 * - offset  偏移量，默认 0
 *
 * 响应：`{ code, artists: NeteaseArtist[], more }`——注意上游不返回 `total`，
 * 判断还有没有下一页要用 `more` 或「本页条数是否满页」。
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

/** 地区取值白名单（-1 全部 / 7 华语 / 96 欧美 / 8 日本 / 16 韩国） */
const ARTIST_AREAS = new Set([-1, 7, 96, 8, 16]);
/** 类型取值白名单 */
const ARTIST_TYPES = new Set([-1, 1, 2, 3]);

/** 取整数参数；非法值回退到默认，避免把垃圾透给上游 */
const pickInt = (value: unknown, fallback: number, allowed: Set<number>): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && allowed.has(parsed) ? parsed : fallback;
};

const artistList: NeteaseModule = (query, request) => {
  const data = {
    area: pickInt(query.area, -1, ARTIST_AREAS),
    type: pickInt(query.type, -1, ARTIST_TYPES),
    initial: Number.isInteger(Number(query.initial)) ? Number(query.initial) : -1,
    limit: query.limit ?? 30,
    offset: Number(query.offset ?? 0) || 0,
  };
  return request("/api/v1/artist/list", data, createOption(query, "weapi"));
};

export default artistList;
