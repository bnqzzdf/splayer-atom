/**
 * KG 模块注册表
 */

import type { KGModule } from "../core/types";

import lyric from "./lyric";
import search from "./search";
import album from "./album";
import artist from "./artist";
import playlist from "./playlist";
import userDetail from "./user_detail";
import { loginQrCheck, loginQrKey } from "./login_qr";
import songUrl from "./song_url";
import comment from "./comment";
import { rankDetail, rankList } from "./rank";
import playlistSquare from "./playlist_square";
import newSong from "./newsong";
import hotArtist from "./hot_artist";

export const modules: Record<string, KGModule> = {
  lyric,
  search,
  album,
  artist,
  playlist,
  song_list: playlist,
  rank_list: rankList,
  rank_detail: rankDetail,
  hot_playlists: playlistSquare,
  new_songs: newSong,
  hot_artists: hotArtist,
  user_detail: userDetail,
  login_qr_key: loginQrKey,
  login_qr_check: loginQrCheck,
  song_url: songUrl,
  comment,
};
