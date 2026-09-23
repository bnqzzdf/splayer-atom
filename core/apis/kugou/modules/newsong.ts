/**
 * KG 新歌首发
 *
 * 端点：http://m.kugou.com/newsong/index&json=true
 *
 * 说明：`mobilecdn` 通道没有新歌路径（`/api/v3/song/new`、`/api/v3/newsong/list`、
 * `/api/v3/newalbum/list` 全部 "Access Deny"），但移动站的 newsong 频道可用，
 * 实测一次返回 99 首，字段与 `rank/song` 完全一致（`authors[]` 家族），
 * 因此复用 core/song 的归一化，保证新歌与榜单的取流字段（hash / albumAudioId）一致。
 *
 * params:
 * - limit  截断条数（用于首页书架），不传则返回全部
 */

import { kgRequest } from "../core/request";
import { normalizeKgAuthorSong, type KGRawAuthorSong } from "../core/song";
import type { KGModule } from "../core/types";

interface NewSongResp {
  type?: number;
  newSongList?: KGRawAuthorSong[];
}

const newSong: KGModule = async (params) => {
  const whole = typeof params.limit === "number" ? Number(params.limit) : undefined;

  const body = await kgRequest<NewSongResp>("http://m.kugou.com/newsong/index&json=true");
  const all = (body.newSongList ?? []).map((song) => normalizeKgAuthorSong(song));
  const songs = whole && whole > 0 ? all.slice(0, whole) : all;

  return { code: 200, total: all.length, songs };
};

export default newSong;
