import type { Playlist, Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import { netease as neteaseApi } from "@/apis/netease";
import { ensureOk, songsToTracks, toAlbum, toArtist, toPlaylist } from "@/utils/format/netease";
import { albumToCoverItem, artistToCoverItem } from "@/utils/format/coverItem";
import { songsByIds } from "@/apis/song/netease";

/** song_detail 单批上限 */
const SONG_DETAIL_BATCH = 500;

/** fetchPlaylist 可选参数 */
export interface FetchPlaylistOptions {
  /** 元数据回调 */
  onMeta?: (meta: Playlist) => void;
  /** 曲目分批回调 */
  onBatch?: (batch: Track[]) => void;
  /** 中断信号 */
  signal?: AbortSignal;
}

/**
 * 拉取歌单：元数据 + 全部曲目
 *
 * 1) `playlist/detail` 一次返回 元数据 + 前 ~1000 首完整 song + 全量 trackIds
 * 2) 若 trackIds 还有未覆盖的，按 500 一批走 `song/detail` 补尾
 *
 * @param playlistId 歌单 id
 * @param options 元数据/曲目回调与中断信号
 */
export const fetchPlaylist = async (
  playlistId: string,
  options: FetchPlaylistOptions = {},
): Promise<void> => {
  if (options.signal?.aborted) return;
  const body = await neteaseApi.playlist_detail({ id: playlistId });
  if (options.signal?.aborted) return;
  const raw = body?.playlist;
  if (!raw) return;

  options.onMeta?.(toPlaylist(raw));

  const firstBatch = songsToTracks(raw.tracks);
  if (firstBatch.length > 0) options.onBatch?.(firstBatch);

  const have = new Set(firstBatch.map((t) => Number(t.id)));
  const missing: number[] = (raw.trackIds ?? [])
    .map((item: { id: number }) => item.id)
    .filter((tid: number) => !have.has(tid));

  for (let i = 0; i < missing.length; i += SONG_DETAIL_BATCH) {
    if (options.signal?.aborted) return;
    const chunk = missing.slice(i, i + SONG_DETAIL_BATCH);
    const batch = await songsByIds(chunk);
    if (options.signal?.aborted) return;
    if (batch.length > 0) options.onBatch?.(batch);
  }
};

/**
 * 新建歌单
 * @param name 歌单名
 * @param privacy 0 公开 / 10 私密
 * @returns 新建的歌单元数据
 */
export const createPlaylist = async (name: string, privacy: 0 | 10 = 0): Promise<Playlist> => {
  const body = ensureOk(await neteaseApi.playlist_create({ name, privacy }));
  return toPlaylist(body.playlist);
};

/**
 * 删除歌单
 * @param id 歌单 id
 */
export const deletePlaylist = async (id: string): Promise<void> => {
  ensureOk(await neteaseApi.playlist_delete({ id }));
};

/**
 * 改歌单名
 * @param id 歌单 id
 * @param name 新名称
 */
export const updatePlaylistName = async (id: string, name: string): Promise<void> => {
  ensureOk(await neteaseApi.playlist_name_update({ id, name }));
};

/**
 * 改歌单描述
 * @param id 歌单 id
 * @param desc 新描述（空字符串清空）
 */
export const updatePlaylistDesc = async (id: string, desc: string): Promise<void> => {
  ensureOk(await neteaseApi.playlist_desc_update({ id, desc }));
};

/**
 * 把曲目加入歌单
 * @param playlistId 歌单 id
 * @param trackIds 曲目 id 列表
 * @returns 实际加入条数
 */
export const addToPlaylist = async (playlistId: string, trackIds: string[]): Promise<number> => {
  if (trackIds.length === 0) return 0;
  const body = ensureOk(
    await neteaseApi.playlist_tracks({
      op: "add",
      pid: playlistId,
      tracks: trackIds.join(","),
    }),
  );
  return typeof body.count === "number" ? body.count : trackIds.length;
};

/**
 * 从歌单移除曲目
 * @param playlistId 歌单 id
 * @param trackIds 曲目 id 列表
 */
export const removeFromPlaylist = async (playlistId: string, trackIds: string[]): Promise<void> => {
  if (trackIds.length === 0) return;
  ensureOk(
    await neteaseApi.playlist_tracks({
      op: "del",
      pid: playlistId,
      tracks: trackIds.join(","),
    }),
  );
};

/**
 * 订阅 / 取消订阅他人歌单
 * @param id 歌单 id
 * @param subscribe true 订阅 / false 取消
 */
export const subscribePlaylist = async (id: string, subscribe: boolean): Promise<void> => {
  ensureOk(await neteaseApi.playlist_subscribe({ id, t: subscribe ? 1 : 2 }));
};

/**
 * 重排自建歌单顺序
 * @param ids 期望顺序的歌单 id 数组
 */
export const reorderPlaylists = async (ids: string[]): Promise<void> => {
  ensureOk(await neteaseApi.playlist_order_update({ ids: JSON.stringify(ids) }));
};

/** 新碟上架响应：核心侧 album_new 原样透出网易的 albums */
interface NcmAlbumsResponse {
  code?: number;
  albums?: unknown[];
}

/** 热门歌手响应：核心侧 artist_list 原样透出网易的 artists */
interface NcmArtistsResponse {
  code?: number;
  artists?: unknown[];
}

/**
 * 获取网易新碟上架
 *
 * 首页那版（recommend/netease.ts 的 fetchNewAlbums）写死了「全部」第一页；
 * 平台页要地区标签和「更多」，所以这里把 area/offset 传出去。
 *
 * @param limit - 返回条数
 * @param area - 地区：ALL 全部 / ZH 华语 / EA 欧美 / KR 韩国 / JP 日本
 * @param offset - 偏移量（「更多」翻页用）
 * @returns 专辑卡片列表；其 id 可直接用于 album/netease/<id>
 */
export const fetchNeteaseNewAlbums = async (
  limit = 30,
  area = "ALL",
  offset = 0,
): Promise<CoverItem[]> => {
  const body = await neteaseApi.album_new<NcmAlbumsResponse>({ area, offset, limit });
  return (body?.albums ?? []).map((raw) => albumToCoverItem(toAlbum(raw)));
};

/**
 * 获取网易热门歌手
 * @param limit - 返回条数
 * @param area - 地区：-1 全部 / 7 华语 / 96 欧美 / 8 日本 / 16 韩国
 * @param offset - 偏移量（「更多」翻页用）
 * @returns 歌手卡片列表；其 id 可直接用于 artist/netease/<id>
 */
export const fetchNeteaseHotArtists = async (
  limit = 30,
  area = -1,
  offset = 0,
): Promise<CoverItem[]> => {
  const body = await neteaseApi.artist_list<NcmArtistsResponse>({ area, offset, limit });
  return (body?.artists ?? []).map((raw) => artistToCoverItem(toArtist(raw)));
};
