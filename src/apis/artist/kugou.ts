import type { Track } from "@shared/types/player";
import type { ArtistProfile } from "@/types/artist";
import { kugou as kgApi } from "@/apis/kugou";
import {
  kgAlbumToCoverItem,
  kgSongsToTracks,
  type KGAlbumItem,
  type KGArtistItem,
  type KGSong,
} from "@/utils/format/kugou";

interface KGArtistDetailResponse {
  code?: number;
  message?: string;
  artist?: KGArtistItem & { intro?: string; avatar?: string };
  songs?: KGSong[];
  albums?: KGAlbumItem[];
}

/**
 * 获取KG歌手详情、热门单曲与专辑
 * @param id - 歌手 ID
 * @param fallbackName - 兜底名称
 * @returns 歌手资料 profile
 */
export const fetchKugouArtist = async (
  id: string,
  fallbackName: string,
): Promise<ArtistProfile> => {
  const body = await kgApi.artist<KGArtistDetailResponse>({ id });
  if (body.code !== 200) throw new Error(body.message || `KG 歌手请求失败: ${body.code}`);

  const tracks = kgSongsToTracks(body.songs);
  const albums = (body.albums ?? []).map(kgAlbumToCoverItem);
  const artistId = String(body.artist?.id ?? id);

  return {
    id: artistId,
    name: body.artist?.name || fallbackName,
    avatar: body.artist?.avatar || body.artist?.cover,
    source: "kugou",
    tracks,
    albums,
    trackCount: body.artist?.songCount ?? tracks.length,
    albumCount: body.artist?.albumCount ?? albums.length,
  };
};

/**
 * 触底加载更多 KG 歌手歌曲
 * @param id - 歌手 ID
 * @param offset - 已加载歌曲数
 * @param limit - 单页数量
 * @returns 新一页歌曲与是否还有更多
 */
export const fetchKugouArtistSongs = async (
  id: string,
  offset: number,
  limit = 50,
): Promise<{ tracks: Track[]; more: boolean }> => {
  const page = Math.floor(offset / limit) + 1;
  const body = await kgApi.artist<KGArtistDetailResponse>({
    id,
    page,
    pagesize: limit,
    includeAlbums: false,
  });
  if (body.code !== 200) throw new Error(body.message || `KG 歌手歌曲请求失败: ${body.code}`);
  const tracks = kgSongsToTracks(body.songs);
  const total = body.artist?.songCount;
  return {
    tracks,
    more: total != null ? offset + tracks.length < total : tracks.length >= limit,
  };
};
