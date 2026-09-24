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
