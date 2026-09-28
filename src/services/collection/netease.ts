import type { Track } from "@shared/types/player";
import type { Collection, CollectionType } from "@/types/collection";
import { fetchAlbum } from "@/apis/album/netease";
import { fetchPlaylist } from "@/apis/playlist/netease";
import type { LoadCollectionOptions } from "./types";

export const loadNeteaseCollection = async (
  type: CollectionType,
  id: string,
  options: LoadCollectionOptions,
): Promise<void> => {
  if (type === "album") {
    const result = await fetchAlbum(decodeURIComponent(id));
    if (options.signal?.aborted) return;
    options.onUpdate(
      result
        ? {
            id,
            type,
            source: "netease",
            title: result.album.name,
            cover: result.album.cover,
            description: result.description,
            creator: result.album.artist,
            tracks: result.tracks,
            trackCount: result.tracks.length,
          }
        : null,
    );
    return;
  }
  // rank（平台排行榜）与 playlist 走同一条通路：网易的榜单 id 本身就是歌单 id
  // （实测 playlist/detail?id=19723756 直接返回飙升榜），所以不必另做取歌实现，
  // 只把 type 原样带出去，让详情页按榜单语义展示。
  if (type !== "playlist" && type !== "rank") {
    options.onUpdate(null);
    return;
  }

  const tracks: Track[] = [];
  let meta: {
    name: string;
    cover?: string;
    description?: string;
    creator?: string;
    count?: number;
  };
  const current = (): Collection | null =>
    meta
      ? {
          id,
          type,
          source: "netease",
          title: meta.name,
          cover: meta.cover,
          description: meta.description,
          creator: meta.creator,
          tracks: [...tracks],
          trackCount: meta.count ?? tracks.length,
        }
      : null;
  await fetchPlaylist(id, {
    signal: options.signal,
    onMeta: (value) => {
      meta = {
        name: value.name,
        cover: value.cover,
        description: value.description,
        creator: value.owner,
        count: value.trackCount,
      };
      if (!options.signal?.aborted) options.onUpdate(current());
    },
    onBatch: (batch) => {
      tracks.push(...batch);
      if (!options.signal?.aborted) options.onUpdate(current());
    },
  });
};
