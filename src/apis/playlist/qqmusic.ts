import type { Playlist, Track } from "@shared/types/player";
import { qqmusic as qmApi } from "@/apis/qqmusic";
import { qqSongsToTracks, type QMSong } from "@/utils/format/qqmusic";

interface PlaylistResponse {
  code?: number;
  message?: string;
  id?: string | number;
  name?: string;
  description?: string;
  creator?: string;
  cover?: string;
  total?: number;
  songs?: QMSong[];
}

export const fetchQQMusicPlaylist = async (
  id: string,
  fallbackName: string,
): Promise<{ playlist: Playlist; tracks: Track[] }> => {
  const body = await qmApi.song_list<PlaylistResponse>({ id });
  if (body.code !== 200) throw new Error(body.message || `QM 歌单请求失败: ${body.code}`);
  const tracks = qqSongsToTracks(body.songs);
  return {
    playlist: {
      id: String(body.id ?? id),
      name: body.name || fallbackName,
      cover: body.cover || tracks[0]?.cover,
      description: body.description,
      owner: body.creator,
      trackCount: body.total ?? tracks.length,
    },
    tracks,
  };
};

/** QM 榜单目录条目 */
export interface QMToplistEntry {
  id: string;
  name: string;
  cover: string;
  total: number;
  playCount: number;
  updateTime: string;
  description: string;
}

/** QM 榜单目录分组 */
export interface QMToplistGroup {
  id: string;
  name: string;
  items: QMToplistEntry[];
}

interface ToplistIndexResponse {
  code?: number;
  message?: string;
  total?: number;
  groups?: QMToplistGroup[];
}

/**
 * 获取 QM 榜单目录（分类 + 全部榜单）
 * @returns 榜单分组，失败时抛错
 */
export const fetchQQMusicToplist = async (): Promise<QMToplistGroup[]> => {
  const body = await qmApi.toplist<ToplistIndexResponse>({});
  if (body.code !== 200) throw new Error(body.message || `QM 榜单目录请求失败: ${body.code}`);
  return (body.groups ?? []).filter((group) => group.items?.length);
};

interface RankResponse {
  code?: number;
  message?: string;
  id?: string | number;
  name?: string;
  description?: string;
  cover?: string;
  updateTime?: string;
  total?: number;
  songs?: QMSong[];
}

/**
 * 获取 QM 榜单详情与歌曲列表
 * @param topid - 榜单 ID
 * @param fallbackName - 兜底名称（目录里已拿到的榜单名）
 * @returns 榜单元数据与 Track 列表
 */
export const fetchQQMusicRank = async (
  topid: string,
  fallbackName: string,
): Promise<{ rank: Playlist; tracks: Track[] }> => {
  const body = await qmApi.leaderboard<RankResponse>({ topid, limit: 100 });
  if (body.code !== 200) throw new Error(body.message || `QM 榜单请求失败: ${body.code}`);
  const tracks = qqSongsToTracks(body.songs);
  return {
    rank: {
      id: String(body.id ?? topid),
      name: body.name || fallbackName,
      cover: body.cover || tracks[0]?.cover,
      description: body.description,
      trackCount: body.total ?? tracks.length,
    },
    tracks,
  };
};
/** QM 歌单广场条目 */
export interface QMHotPlaylist {
  id: string;
  name: string;
  cover: string;
  creator: string;
  description: string;
  playCount: number;
}

interface HotPlaylistsResponse {
  code?: number;
  message?: string;
  total?: number;
  playlists?: QMHotPlaylist[];
}

/**
 * 获取 QM 热门歌单（歌单广场）
 * @param limit - 返回条数
 * @param offset - 偏移量
 * @returns 歌单列表；其 id 可直接用于 collection/qqmusic/playlist/<id>
 */
export const fetchQQMusicHotPlaylists = async (
  limit = 30,
  offset = 0,
): Promise<QMHotPlaylist[]> => {
  const body = await qmApi.hot_playlists<HotPlaylistsResponse>({ limit, offset });
  if (body.code !== 200) throw new Error(body.message || `QM 热门歌单请求失败: ${body.code}`);
  return body.playlists ?? [];
};

/**
 * 获取 QM 新歌首发
 * @param limit - 返回条数
 * @param type - 地区/语种：1 内地 / 2 欧美 / 3 日本 / 4 韩国 / 5 最新 / 6 港台
 * @returns Track 列表（带着 mid 与 mediaMid，可直接取流）
 */
export const fetchQQMusicNewSongs = async (limit = 30, type = 5): Promise<Track[]> => {
  const body = await qmApi.new_songs<{ code?: number; message?: string; songs?: QMSong[] }>({
    limit,
    type,
  });
  if (body.code !== 200) throw new Error(body.message || `QM 新歌请求失败: ${body.code}`);
  return qqSongsToTracks(body.songs);
};

/** QM 新碟首发条目 */
export interface QMNewAlbum {
  /** 专辑 MID，可直接用于 collection/qqmusic/album/<id> */
  id: string;
  name: string;
  artist: string;
  publishTime: string;
}

interface NewAlbumsResponse {
  code?: number;
  message?: string;
  total?: number;
  albums?: QMNewAlbum[];
}

/**
 * 获取 QM 新碟首发
 * @param limit - 返回条数
 * @returns 专辑列表；封面由调用方用 `qqAlbumCover(id)` 按尺寸派生
 */
export const fetchQQMusicNewAlbums = async (limit = 30): Promise<QMNewAlbum[]> => {
  const body = await qmApi.new_albums<NewAlbumsResponse>({ num: limit, page: 1 });
  if (body.code !== 200) throw new Error(body.message || `QM 新碟请求失败: ${body.code}`);
  return body.albums ?? [];
};
