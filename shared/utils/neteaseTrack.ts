import type { AudioQuality, Track, TrackFee } from "../types/player";

interface NeteaseTrackArtist {
  id: number | string;
  name: string;
}

interface NeteaseTrackAlbum {
  id: number | string;
  name: string;
  picUrl?: string;
}

interface NeteaseTrackQuality {
  br: number;
  sr: number;
}

/** Renderer 与 Core 都可消费的网易歌曲最小结构。 */
export interface NeteaseTrackSource {
  id: number | string;
  name: string;
  ar?: NeteaseTrackArtist[];
  artists?: NeteaseTrackArtist[];
  al?: NeteaseTrackAlbum;
  album?: NeteaseTrackAlbum;
  dt?: number;
  duration?: number;
  alia?: string[];
  alias?: string[];
  h?: NeteaseTrackQuality | null;
  m?: NeteaseTrackQuality | null;
  l?: NeteaseTrackQuality | null;
  sq?: NeteaseTrackQuality | null;
  hr?: NeteaseTrackQuality | null;
  fee?: TrackFee;
  pc?: unknown;
}

export const withNeteasePicSize = (url: string | undefined, size = 300): string | undefined => {
  if (!url) return undefined;
  if (url.includes("?param=")) return url;
  return `${url}?param=${size}y${size}`;
};

const pickQuality = (song: NeteaseTrackSource): AudioQuality | undefined => {
  if (song.hr) {
    return {
      codec: "flac",
      sampleRate: song.hr.sr,
      bitsPerSample: 24,
      bitRate: song.hr.br,
      channels: 2,
    };
  }
  if (song.sq) {
    return {
      codec: "flac",
      sampleRate: song.sq.sr,
      bitsPerSample: 16,
      bitRate: song.sq.br,
      channels: 2,
    };
  }
  const mp3 = song.h ?? song.m ?? song.l;
  if (!mp3) return undefined;
  return {
    codec: "mp3",
    sampleRate: mp3.sr,
    bitsPerSample: 16,
    bitRate: mp3.br,
    channels: 2,
  };
};

/** 网易歌曲原始对象 → canonical Track；Core/Control 共用同一映射。 */
export const neteaseSongToTrack = (song: NeteaseTrackSource): Track => {
  const album = song.al ?? song.album;
  const artists = song.ar ?? song.artists ?? [];
  const aliases = song.alia ?? song.alias;
  const cover = withNeteasePicSize(album?.picUrl);
  return {
    id: String(song.id),
    source: "netease",
    title: song.name,
    comment: aliases?.find((value) => value?.trim()) ?? undefined,
    artists: artists.map((artist) => ({ id: String(artist.id), name: artist.name })),
    album: album ? { id: String(album.id), name: album.name, cover } : undefined,
    duration: song.dt ?? song.duration ?? 0,
    cover,
    coverOriginal: withNeteasePicSize(album?.picUrl, 1024),
    quality: pickQuality(song),
    fee: song.fee,
    cloud: song.pc != null ? true : undefined,
  };
};

export const neteaseSongsToTracks = (
  songs: readonly NeteaseTrackSource[] | undefined | null,
): Track[] => songs?.map(neteaseSongToTrack) ?? [];
