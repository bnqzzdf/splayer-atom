import type { Track } from "@shared/types/player";
import { netease as neteaseApi } from "@/apis/netease";
import { songsToTracks } from "@/utils/format/netease";

/**
 * 按 ID 批量取歌曲详情
 * @param ids - 平台 songId 列表
 * @returns 与传入 ids 对应的 Track 列表
 */
export const songsByIds = async (ids: Array<string | number>): Promise<Track[]> => {
  const cleaned = ids.map((v) => String(v).trim()).filter(Boolean);
  if (cleaned.length === 0) return [];
  const body = await neteaseApi.song_detail({ ids: cleaned.join(",") });
  return songsToTracks(body?.songs);
};
