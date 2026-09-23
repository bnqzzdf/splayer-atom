/**
 * 歌手页加载服务：按 source 派发到具体来源
 */

import type { Track, TrackSource } from "@shared/types/player";
import type { ArtistProfile } from "@/types/artist";
import { useLibraryStore } from "@/stores/library";
import { useStreamingStore } from "@/stores/streaming";
import {
  fetchArtist as fetchNeteaseArtist,
  fetchArtistSongs as fetchNeteaseArtistSongs,
} from "@/apis/artist/netease";
import { fetchQQMusicArtist, fetchQQMusicArtistSongs } from "@/apis/artist/qqmusic";
import { fetchKugouArtist, fetchKugouArtistSongs } from "@/apis/artist/kugou";
import { fetchArtist as fetchQobuzArtist } from "@/apis/artist/qobuz";
import { fetchArtist as fetchTidalArtist } from "@/apis/artist/tidal";
import { albumsToCoverItems } from "@/utils/format/coverItem";
import { libraryClient } from "@/core/libraryClient";

export interface LoadArtistOptions {
  /** 名称兜底（在线源元数据返回前用于占位） */
  fallbackName?: string;
  /** 数据更新回调（一次或多次） */
  onUpdate: (artist: ArtistProfile | null) => void;
  /** 中断信号 */
  signal?: AbortSignal;
}

/**
 * 歌手页触底分页描述。
 *
 * 分页是**来源自己的能力**：歌手页只拿这一个描述去驱动触底加载，不感知平台。
 * 首屏数量不足以判断是否还有更多时，`hasMore` 由来源按平台语义给出。
 */
export interface ArtistPagination {
  hasMore: boolean;
  loadMore: (offset: number, limit: number) => Promise<{ tracks: Track[]; more: boolean }>;
}

/** 首屏 50 首是各在线源的事实分页单位，少于它即可确定已经到底。 */
const FIRST_PAGE_SIZE = 50;

/** 首屏即为分页单位时的通用判定。 */
const paginationFor = (
  tracks: Track[],
  loadMore: ArtistPagination["loadMore"],
): ArtistPagination => ({ hasMore: tracks.length >= FIRST_PAGE_SIZE, loadMore });

/**
 * 加载指定歌手
 * @param source - 来源：local / streaming / netease / qqmusic / kugou / qobuz / tidal
 * @param id     歌手 id（route 原始字符串）
 * @param options 回调与中断信号
 * @returns 该来源的分页描述；不支持分页的来源返回 null
 */
export const loadArtist = async (
  source: TrackSource,
  id: string,
  options: LoadArtistOptions,
): Promise<ArtistPagination | null> => {
  if (source === "local") {
    await loadLocal(id, options);
    return null;
  }
  if (source === "streaming") {
    await loadStreaming(id, options);
    return null;
  }
  if (source === "netease") {
    return loadNetease(id, options);
  }
  if (source === "qqmusic") {
    return loadQQMusic(id, options);
  }
  if (source === "kugou") {
    return loadKugou(id, options);
  }
  if (source === "qobuz") {
    await loadQobuz(id, options);
    return null;
  }
  if (source === "tidal") {
    await loadTidal(id, options);
    return null;
  }
  options.onUpdate(null);
  return null;
};

const loadLocal = async (id: string, options: LoadArtistOptions): Promise<void> => {
  const libraryStore = useLibraryStore();
  const artistName = decodeURIComponent(id);
  const profile = await libraryStore.getArtistProfile(artistName);
  if (options.signal?.aborted) return;
  options.onUpdate(profile);

  // 头像异步补：本地无头像时去主进程取一次，命中后再次 onUpdate
  if (profile && !profile.avatar) {
    const res = await libraryClient.fetchArtistAvatar(artistName);
    if (options.signal?.aborted) return;
    if (res.success && res.data) {
      libraryStore.setArtistAvatar(artistName, res.data);
      options.onUpdate({ ...profile, avatar: res.data });
    }
  }
};

const loadStreaming = async (id: string, options: LoadArtistOptions): Promise<void> => {
  const streamingStore = useStreamingStore();
  const artistId = decodeURIComponent(id);
  const cached = streamingStore.artists.find((a) => a.id === artistId);
  const fallbackName = options.fallbackName ?? artistId;
  const tracks = await streamingStore.fetchArtistSongs(artistId);
  if (options.signal?.aborted) return;
  options.onUpdate({
    id: artistId,
    name: cached?.name ?? fallbackName,
    avatar: cached?.avatar,
    source: "streaming",
    tracks,
    albums: [],
    trackCount: tracks.length,
    albumCount: 0,
  });
};

const loadNetease = async (
  id: string,
  options: LoadArtistOptions,
): Promise<ArtistPagination | null> => {
  const artistId = decodeURIComponent(id);
  const result = await fetchNeteaseArtist(artistId);
  if (options.signal?.aborted) return null;
  if (!result) {
    options.onUpdate(null);
    return null;
  }
  const albums = albumsToCoverItems(result.albums);
  options.onUpdate({
    id,
    name: result.artist.name,
    avatar: result.artist.avatar,
    source: "netease",
    tracks: result.tracks,
    albums,
    trackCount: result.tracks.length,
    albumCount: albums.length,
  });
  return paginationFor(result.tracks, (offset, limit) =>
    fetchNeteaseArtistSongs(artistId, offset, limit),
  );
};

const loadQQMusic = async (
  id: string,
  options: LoadArtistOptions,
): Promise<ArtistPagination | null> => {
  const artistId = decodeURIComponent(id);
  const profile = await fetchQQMusicArtist(artistId, options.fallbackName ?? artistId);
  if (options.signal?.aborted) return null;
  options.onUpdate(profile);
  return paginationFor(profile.tracks, (offset, limit) =>
    fetchQQMusicArtistSongs(artistId, offset, limit),
  );
};

const loadKugou = async (
  id: string,
  options: LoadArtistOptions,
): Promise<ArtistPagination | null> => {
  const artistId = decodeURIComponent(id);
  const profile = await fetchKugouArtist(artistId, options.fallbackName ?? artistId);
  if (options.signal?.aborted) return null;
  options.onUpdate(profile);
  return paginationFor(profile.tracks, (offset, limit) =>
    fetchKugouArtistSongs(artistId, offset, limit),
  );
};

const loadQobuz = async (id: string, options: LoadArtistOptions): Promise<void> => {
  const result = await fetchQobuzArtist(decodeURIComponent(id));
  if (options.signal?.aborted) return;
  if (!result) {
    options.onUpdate(null);
    return;
  }
  const albums = albumsToCoverItems(result.albums);
  options.onUpdate({
    id,
    name: result.artist.name,
    avatar: result.artist.avatar,
    source: "qobuz",
    tracks: result.tracks,
    albums,
    playlists: result.playlists,
    trackCount: result.tracks.length,
    albumCount: albums.length,
  });
};

const loadTidal = async (id: string, options: LoadArtistOptions): Promise<void> => {
  const result = await fetchTidalArtist(decodeURIComponent(id));
  if (options.signal?.aborted) return;
  if (!result) {
    options.onUpdate(null);
    return;
  }
  const albums = albumsToCoverItems(result.albums);
  options.onUpdate({
    id,
    name: result.artist.name,
    avatar: result.artist.avatar,
    source: "tidal",
    tracks: result.tracks,
    albums,
    trackCount: result.tracks.length,
    albumCount: albums.length,
  });
};
