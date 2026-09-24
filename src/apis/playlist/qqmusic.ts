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
