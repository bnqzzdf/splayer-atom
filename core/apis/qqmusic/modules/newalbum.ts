/**
 * QM 新碟首发
 *
 * module: newalbum.NewAlbumServer / get_new_album_info
 *
 * 参数名是坑：这个接口要的是 `albumType`，传 `type` 会回 `code=10006`（不是报错文案，
 * 是"参数不认识"），传 `{}` 则回 `code=2000` 且 albums 为空——两者都不报异常，
 * 很容易被当成"没有新碟"。`area` 也可用，效果与 albumType 相同。
 *
 * 实测 `{albumType: 1, num: 20, page: 1}` → code=0、total=4395、本页 20 张。
 *
 * params:
 * - albumType  地区：1 全部（默认）
 * - num        每页条数，默认 20
 * - page       页码，从 1 开始
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
  const albumType = Number(params.albumType ?? params.area ?? 1) || 1;
  const num = Number(params.num ?? params.limit ?? 20) || 20;
  const page = Number(params.page ?? 1) || 1;

  const data = await qmRequest<{ albums?: RawNewAlbum[]; total?: number }>(
    "newalbum.NewAlbumServer",
    "get_new_album_info",
    { albumType, num, page },
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

  return { code: 200, albumType, page, total: data.total ?? albums.length, albums };
};

export default newAlbum;
