/**
 * 新碟上架（无需登录）
 *
 * `area` 就是网易「新碟上架」那排地区标签：ALL 全部 / ZH 华语 / EA 欧美 / KR 韩国 / JP 日本。
 * 早期这里把 area 写死成 ALL、offset 写死成 0，页面因此只能看「全部」的第一页；
 * 平台页的地区标签与「更多」都要靠这两个参数，所以开放出来。
 *
 * params:
 * - area    地区，默认 ALL
 * - limit   每页条数，默认 30
 * - offset  偏移量，默认 0（「更多」翻页用）
 *
 * 响应：`{ code, albums: NeteaseAlbum[], total }`——`total` 实测恒为 500（上游上限），
 * 不是真实总数，判断还有没有下一页要看本页是否满页或继续探 offset。
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

/** 只放行白名单，避免把任意字符串透给上游 */
const ALBUM_AREAS = new Set(["ALL", "ZH", "EA", "KR", "JP"]);

const albumNew: NeteaseModule = (query, request) => {
  const area = String(query.area ?? "ALL").toUpperCase();
  const data = {
    area: ALBUM_AREAS.has(area) ? area : "ALL",
    offset: Number(query.offset ?? 0) || 0,
    total: true,
    limit: query.limit ?? 30,
  };
  return request("/api/album/new", data, createOption(query, "weapi"));
};

export default albumNew;
