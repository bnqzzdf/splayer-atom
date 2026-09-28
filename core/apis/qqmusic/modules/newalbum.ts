/**
 * QM 新碟首发
 *
 * module: newalbum.NewAlbumServer / get_new_album_info
 *
 * 地区参数是 **`area`**，官方那排标签就是它：
 *   1 内地（total 4395）/ 2 港台（1096）/ 3 欧美（6170）/ 4 韩国（1642）/ 5 日本（1653）
 *
 * 两个踩过的坑：
 * - 传 `type` 会回 `code=10006`（参数不认识），传 `{}` 则回 `code=2000` 且 albums 为空——
 *   两者都不抛异常，很容易被当成"没有新碟"；
 * - `albumType` 会被静默忽略（任何值都返回同一份数据）。当初只用 `area=1` 做过单值测试，
 *   而它恰好与"不传"等价，于是误判成"该接口不支持地区筛选"。**改参数名时要多值验证**。
 *
 * params:
 * - area   地区：1 内地（默认）/ 2 港台 / 3 欧美 / 4 韩国 / 5 日本
 * - num    每页条数，默认 20
 * - page   页码，从 1 开始
 */

import { formatSingerName } from "../core/config";
import { qmRequest } from "../core/request";
import type { QMModule } from "../core/types";

interface RawNewAlbum {
  mid?: string;
  name?: string;
  singers?: Array<{ mid?: string; name?: string }>;
  singer?: Array<{ mid?: string; name?: string }>;
  release_time?: string;
  publish_date?: string;
}

const newAlbum: QMModule = async (params) => {
  const area = Number(params.area ?? 1) || 1;
  const num = Number(params.num ?? params.limit ?? 20) || 20;
  const page = Number(params.page ?? 1) || 1;

  const data = await qmRequest<{ albums?: RawNewAlbum[]; total?: number }>(
    "newalbum.NewAlbumServer",
    "get_new_album_info",
    { area, num, page },
  );

  const albums = (data.albums ?? [])
    .filter((album) => Boolean(album?.mid))
    .map((album) => {
      const singers = album.singers ?? album.singer ?? [];
      return {
        id: album.mid ?? "",
        name: album.name ?? "",
        artist: formatSingerName(singers),
        publishTime: album.release_time ?? album.publish_date ?? "",
      };
    });

  return { code: 200, area, page, total: data.total ?? albums.length, albums };
};

export default newAlbum;
