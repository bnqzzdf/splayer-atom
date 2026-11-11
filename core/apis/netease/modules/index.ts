/**
 * Netease API 模块注册表
 *
 * 每新增一个 module，在这里用一行 import + export 接入即可。
 * 运行时通过 `callNetease(name, params)` 按 key 路由。
 */

import type { NeteaseModule } from "../core/types";

// 登录 / 会话
import login_qr_check from "./login_qr_check";
import login_qr_key from "./login_qr_key";
import login_refresh from "./login_refresh";
import login_status from "./login_status";
import logout from "./logout";
import register_anonimous from "./register_anonimous";

// 用户
import user_cloud from "./user_cloud";
import user_cloud_del from "./user_cloud_del";
import user_level from "./user_level";
import user_playlist from "./user_playlist";
import user_subcount from "./user_subcount";

// 搜索
import cloudsearch from "./cloudsearch";
import search from "./search";
import search_hot_detail from "./search_hot_detail";
import search_suggest from "./search_suggest";

// 歌词
import lyric_new from "./lyric_new";

// 评论
import comment_music from "./comment_music";
import comment_hot from "./comment_hot";

// 播放
import song_detail from "./song_detail";
import song_url from "./song_url";
import song_download_url from "./song_download_url";
import playmode_intelligence from "./playmode_intelligence";
import personal_fm from "./personal_fm";
import fm_trash from "./fm_trash";
import scrobble from "./scrobble";
import scrobble_v1 from "./scrobble_v1";

// 每日推荐 / 发现
import recommend_songs from "./recommend_songs";
import personalized from "./personalized";
import recommend_resource from "./recommend_resource";
import top_artists from "./top_artists";
import toplist from "./toplist";
import album_new from "./album_new";

// 歌单 / 喜欢
import playlist_detail from "./playlist_detail";
import playlist_create from "./playlist_create";
import playlist_delete from "./playlist_delete";
import playlist_tracks from "./playlist_tracks";
import playlist_subscribe from "./playlist_subscribe";
import playlist_name_update from "./playlist_name_update";
import playlist_desc_update from "./playlist_desc_update";
import playlist_order_update from "./playlist_order_update";
import likelist from "./likelist";
import like from "./like";
import like_v1 from "./like_v1";

// 专辑
import album from "./album";
import album_sub from "./album_sub";

// 歌手
import artists from "./artists";
import artist_album from "./artist_album";
import artist_songs from "./artist_songs";
import artist_list from "./artist_list";

// 用户收藏
import album_sublist from "./album_sublist";
import artist_sub from "./artist_sub";
import artist_sublist from "./artist_sublist";

export const modules: Record<string, NeteaseModule> = {
  login_qr_check,
  login_qr_key,
  login_refresh,
  login_status,
  logout,
  register_anonimous,

  user_cloud,
  user_cloud_del,
  user_level,
  user_playlist,
  user_subcount,

  cloudsearch,
  search,
  search_hot_detail,
  search_suggest,

  lyric_new,

  comment_music,
  comment_hot,

  song_detail,
  song_url,
  song_download_url,
  playmode_intelligence,
  personal_fm,
  fm_trash,
  scrobble,
  scrobble_v1,

  recommend_songs,
  personalized,
  recommend_resource,
  top_artists,
  toplist,
  album_new,

  playlist_detail,
  playlist_create,
  playlist_delete,
  playlist_tracks,
  playlist_subscribe,
  playlist_name_update,
  playlist_desc_update,
  playlist_order_update,
  likelist,
  like,
  like_v1,

  album,
  album_sub,

  artists,
  artist_list,
  artist_album,
  artist_songs,

  album_sublist,
  artist_sub,
  artist_sublist,
};
