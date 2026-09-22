import type { Album, Artist, Playlist } from "@shared/types/player";
import {
  neteaseSongToTrack,
  neteaseSongsToTracks,
  withNeteasePicSize,
} from "@shared/utils/neteaseTrack";
import type { UserSubcount } from "@/types/user";
import type { NeteaseSong } from "@/types/netease";

interface NeteaseError {
  code?: number;
  message?: string;
  msg?: string;
}

/**
 * 校验网易云接口响应
 * code !== 200 时抛 Error，message 取自 body.message / body.msg
 */
export const ensureOk = <T>(body: T): T => {
  const meta = body as NeteaseError | null | undefined;
  if (!meta || meta.code !== 200) {
    throw new Error(meta?.message ?? meta?.msg ?? "");
  }
  return body;
};

/** renderer compatibility exports；实际映射实现由 shared/Core 共用。 */
export const withPicSize = withNeteasePicSize;
export const songToTrack = (song: NeteaseSong) => neteaseSongToTrack(song);
export const songsToTracks = (songs: NeteaseSong[] | undefined | null) =>
  neteaseSongsToTracks(songs);

/**
 * 歌单条目 → 应用层 Playlist
 * 适用 `/user/playlist` 与 `/playlist/detail` 的 playlist 字段
 */
export const toPlaylist = (raw: any): Playlist => ({
  id: String(raw.id),
  name: raw.name,
  cover: withPicSize(raw.coverImgUrl),
  description: raw.description,
  trackCount: raw.trackCount,
  owner: raw.creator?.nickname,
});

/** 收藏专辑（/album/sublist 元素）→ 应用层 Album */
export const toAlbum = (raw: any): Album => ({
  id: String(raw.id),
  name: raw.name,
  cover: withPicSize(raw.picUrl),
  artist: raw.artists?.map((a: { name: string }) => a.name).join(" / ") ?? raw.artist?.name,
  trackCount: raw.size,
  year: raw.publishTime ? new Date(raw.publishTime).getFullYear() : undefined,
});

/** 收藏歌手（/artist/sublist 元素）→ 应用层 Artist */
export const toArtist = (raw: any): Artist => ({
  id: String(raw.id),
  name: raw.name,
  avatar: withPicSize(raw.img1v1Url ?? raw.picUrl),
  albumCount: raw.albumSize,
});

/** 订阅计数（/user/subcount）→ 应用层 UserSubcount */
export const toSubcount = (raw: any): UserSubcount => ({
  createdPlaylistCount: raw.createdPlaylistCount ?? 0,
  subPlaylistCount: raw.subPlaylistCount ?? 0,
  artistCount: raw.artistCount ?? 0,
});
