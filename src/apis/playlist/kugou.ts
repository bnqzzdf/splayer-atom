import type { Playlist, Track } from "@shared/types/player";
import { kugou as kgApi } from "@/apis/kugou";
import { kgSongsToTracks, type KGSong } from "@/utils/format/kugou";

interface KGPlaylistDetailResponse {
  code?: number;
  message?: string;
  id?: string | number;
  name?: string;
  description?: string;
  creator?: string;
  cover?: string;
  coverOriginal?: string;
  playCount?: number;
  total?: number;
  songs?: KGSong[];
}

/**
 * 获取KG歌单详情与歌曲列表
 * @param id - 歌单 ID (specialid)
 * @param fallbackName - 兜底名称
 * @returns 歌单元数据与 Track 列表
 */
export const fetchKugouPlaylist = async (
  id: string,
  fallbackName: string,
): Promise<{ playlist: Playlist; tracks: Track[] }> => {
  const body = await kgApi.playlist<KGPlaylistDetailResponse>({ id });
  if (body.code !== 200) throw new Error(body.message || `KG 歌单请求失败: ${body.code}`);

  const tracks = kgSongsToTracks(body.songs);

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

/** KG 榜单目录条目 */
export interface KGRankEntry {
  id: string;
  name: string;
  cover: string;
  playCount: number;
  updateFrequency: string;
  rankType: number;
  description: string;
}

/** KG 榜单目录分组 */
export interface KGRankGroup {
  id: string;
  name: string;
  items: KGRankEntry[];
}

interface RankListResponse {
  code?: number;
  message?: string;
  total?: number;
  groups?: KGRankGroup[];
}

/**
 * 获取 KG 榜单目录（按 classify 分组）
 * @returns 榜单分组，失败时抛错
 */
export const fetchKugouRankList = async (): Promise<KGRankGroup[]> => {
  const body = await kgApi.rank_list<RankListResponse>({});
  if (body.code !== 200) throw new Error(body.message || `KG 榜单目录请求失败: ${body.code}`);
  return (body.groups ?? []).filter((group) => group.items?.length);
};

interface RankDetailResponse {
  code?: number;
  message?: string;
  id?: string | number;
  name?: string;
  description?: string;
  cover?: string;
  coverOriginal?: string;
  total?: number;
  songs?: KGSong[];
}

/**
 * 获取 KG 榜单详情与歌曲列表
 * @param rankid - 榜单 ID
 * @param fallbackName - 兜底名称（目录里已拿到的榜单名）
 * @returns 榜单元数据与 Track 列表
 */
export const fetchKugouRank = async (
  rankid: string,
  fallbackName: string,
): Promise<{ rank: Playlist; tracks: Track[] }> => {
  const body = await kgApi.rank_detail<RankDetailResponse>({ rankid, limit: 200 });
  if (body.code !== 200) throw new Error(body.message || `KG 榜单请求失败: ${body.code}`);

  const tracks = kgSongsToTracks(body.songs);

  return {
    rank: {
      id: String(body.id ?? rankid),
      name: body.name || fallbackName,
      cover: body.cover || tracks[0]?.cover,
      description: body.description,
      trackCount: body.total ?? tracks.length,
    },
    tracks,
  };
};
/** KG 精选歌单条目 */
export interface KGHotPlaylist {
  id: string;
  name: string;
  cover: string;
  coverOriginal: string;
  creator: string;
  description: string;
  playCount: number;
  trackCount: number;
  publishTime: string;
}

interface HotPlaylistsResponse {
  code?: number;
  message?: string;
  page?: number;
  total?: number;
  hasNext?: boolean;
  playlists?: KGHotPlaylist[];
}

/**
 * 获取 KG 精选歌单（移动站歌单频道；接口固定 30 条/页）
 * @param page - 页码，从 1 开始
 * @param limit - 截断条数（用于首页书架）
 * @returns 歌单列表；其 id（specialid）可直接用于 collection/kugou/playlist/<id>
 */
export const fetchKugouHotPlaylists = async (
  page = 1,
  limit?: number,
): Promise<KGHotPlaylist[]> => {
  const body = await kgApi.hot_playlists<HotPlaylistsResponse>(limit ? { page, limit } : { page });
  if (body.code !== 200) throw new Error(body.message || `KG 精选歌单请求失败: ${body.code}`);
  return body.playlists ?? [];
};

/**
 * 获取 KG 新歌首发
 * @param limit - 截断条数（用于首页书架）
 * @returns Track 列表
 */
export const fetchKugouNewSongs = async (limit?: number): Promise<Track[]> => {
  const body = await kgApi.new_songs<{ code?: number; message?: string; songs?: KGSong[] }>(
    limit ? { limit } : {},
  );
  if (body.code !== 200) throw new Error(body.message || `KG 新歌请求失败: ${body.code}`);
  return kgSongsToTracks(body.songs);
};

/** KG 热门歌手条目 */
export interface KGHotArtist {
  /** 歌手 ID，与榜单 authors[].author_id 同一 id 空间，可直接进歌手详情 */
  id: string;
  name: string;
  cover: string;
  coverOriginal: string;
  fansCount: number;
  songCount: number;
  albumCount: number;
}

interface HotArtistsResponse {
  code?: number;
  message?: string;
  page?: number;
  total?: number;
  artists?: KGHotArtist[];
}

/**
 * 获取 KG 热门歌手
 * @param limit - 返回条数（用于首页书架）
 * @returns 歌手列表；其 id 可直接用于 artist/kugou/<id>
 */
export const fetchKugouHotArtists = async (limit = 30): Promise<KGHotArtist[]> => {
  const body = await kgApi.hot_artists<HotArtistsResponse>({ page: 1, limit });
  if (body.code !== 200) throw new Error(body.message || `KG 热门歌手请求失败: ${body.code}`);
  return body.artists ?? [];
};
