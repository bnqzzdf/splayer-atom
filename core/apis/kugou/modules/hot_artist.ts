/**
 * KG 热门歌手
 *
 * 端点：http://mobilecdnbj.kugou.com/api/v5/singer/list?sort=1
 *
 * 为什么是 v5：`/api/v3/singer/rank`、`/api/v3/singer/list` 在该通道一律
 * "Access Deny"——与 newsong 遇到的情况同源，mobilecdn 只放行 rank / special /
 * search / album 等少数路径，歌手目录不在其中。v5 的这个接口可用。
 *
 * `sort` 的语义实测：`sort=1` 才是热门序（首屏 刘欢 / 周杰伦 / 薛之谦 / 林俊杰 /
 * 许嵩 / 周深），`sort=2` 不是热度序，`sort=3` 直接返回空。
 *
 * 条目在 `data.info`（**没有** `data.list` 这个键，按 list 取会得到空数组）。
 * `singerid` 与榜单接口 `authors[].author_id` 是同一 id 空间（实测刘欢两处都是 1580），
 * 所以可以直接交给现有的歌手详情模块（modules/artist.ts 收 `id` / `author_id`）。
 *
 * params:
 * - page   页码，从 1 开始，默认 1
 * - limit  返回条数，默认 30
 */

import { decodeName, fillCover } from "../core/config";
import { kgRequest } from "../core/request";
import type { KGModule } from "../core/types";

interface RawSinger {
  singerid?: number | string;
  singername?: string;
  imgurl?: string;
  fanscount?: number;
  songcount?: number;
  albumcount?: number;
  heat?: number;
}

interface SingerListResp {
  data?: {
    total?: number;
    info?: RawSinger[];
  };
}

const hotArtist: KGModule = async (params) => {
  const page = Number(params.page ?? 1) || 1;
  const limit = Number(params.limit ?? 30) || 30;

  const body = await kgRequest<SingerListResp>(
    `http://mobilecdnbj.kugou.com/api/v5/singer/list?sort=1&page=${page}&pagesize=${limit}&plat=0`,
  );
  const data = body.data ?? {};

  const artists = (data.info ?? [])
    .map((item) => {
      const id = item.singerid != null ? String(item.singerid) : "";
      const name = decodeName(item.singername ?? "");
      if (!id || !name) return null;
      return {
        id,
        name,
        // imgurl 是带 {size} 的模板，由 fillCover 替换并统一升级 https
        cover: fillCover(item.imgurl, 300) ?? "",
        coverOriginal: fillCover(item.imgurl, 480) ?? "",
        fansCount: item.fanscount ?? 0,
        songCount: item.songcount ?? 0,
        albumCount: item.albumcount ?? 0,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return { code: 200, page, total: data.total ?? artists.length, artists };
};

export default hotArtist;
