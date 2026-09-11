/**
 * TIDAL 专辑详情（含曲目列表）
 *
 * 参照 MemoryPlay L10080-10096：
 * TIDAL album_get 只返回元数据，曲目列表需单独调用 album_getTracks。
 * 两者并行请求后合并。
 */

import type { Album, Track } from "@shared/types/player";
import { tidalCall } from "@/apis/tidal";
import { songsToTracks, toAlbum, type TidalAlbum, type TidalTrack } from "@/utils/format/tidal";

interface TidalAlbumTracksResponse {
  items?: TidalTrack[];
  totalNumberOfItems?: number;
}

const fetchAlbumTracks = async (
  albumId: string,
  firstPage: TidalAlbumTracksResponse,
): Promise<TidalTrack[]> => {
  const limit = 50;
  const tracks = [...(firstPage.items ?? [])];
  const total = firstPage.totalNumberOfItems;
  while (tracks.length >= limit && (total == null || tracks.length < total)) {
    const page = await tidalCall<TidalAlbumTracksResponse>("album_getTracks", {
      album_id: albumId,
      limit,
      offset: tracks.length,
    });
    const items = page?.items ?? [];
    if (items.length === 0) break;
    tracks.push(...items);
    if (items.length < limit) break;
  }
  return tracks;
};

/**
 * 拉取专辑：元数据 + 全部曲目
 * 参照 MemoryPlay: Promise.all([tidalGetAlbum(id), tidalGetAlbumTracks(id)])
 * @param albumId 专辑 id
 */
export const fetchAlbum = async (
  albumId: string,
): Promise<{ album: Album; tracks: Track[]; description?: string } | null> => {
  const [data, firstPage] = await Promise.all([
    tidalCall<TidalAlbum>("album_get", { album_id: albumId }),
    tidalCall<TidalAlbumTracksResponse>("album_getTracks", { album_id: albumId, limit: 50 }),
  ]);
  if (!data?.id) return null;
  const tracks = await fetchAlbumTracks(albumId, firstPage ?? {});
  return {
    album: toAlbum(data),
    tracks: songsToTracks(tracks),
    description: data.description,
  };
};
