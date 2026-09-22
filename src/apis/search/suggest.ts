/**
 * 搜索建议（按平台）
 *
 * 只有网易云与 QQ音乐 提供可用的建议接口：
 * - 网易云走 `search_suggest`，四类建议齐全；
 * - QQ音乐没有 suggest 接口，用一次轻量 `search`（单曲，6 条）代替，
 *   并直接带上已转换的 `Track`，点击即可播放。
 * 酷狗/Qobuz/TIDAL 返回空集。
 *
 * 每类条目都带 `source`，界面据此选择正确的详情页来源，不再硬编码网易云。
 */
import type { Platform } from "@shared/types/platform";
import type { Track } from "@shared/types/player";
import { neteaseCall } from "@/apis/netease";
import { qqmusicCall } from "@/apis/qqmusic";
import { qqSongToTrack, type QMSong } from "@/utils/format/qqmusic";

export interface SuggestSongItem {
  id: string;
  name: string;
  /** 多个歌手用 " / " 连接 */
  artist?: string;
  album?: string;
  /** 该建议所属平台 */
  source?: Platform;
  /** 平台能直接给出 canonical Track 时携带，点击即可播放 */
  track?: Track;
}

export interface SuggestSimpleItem {
  id: string;
  name: string;
  subtitle?: string;
  /** 该建议所属平台 */
  source?: Platform;
}

export interface SuggestData {
  songs: SuggestSongItem[];
  albums: SuggestSimpleItem[];
  artists: SuggestSimpleItem[];
  playlists: SuggestSimpleItem[];
  /** 本份建议来自哪个平台 */
  platform: Platform;
}

interface NeteaseSuggestResp {
  result?: {
    songs?: Array<{
      id: number;
      name: string;
      artists?: Array<{ name: string }>;
      album?: { name: string };
    }>;
    albums?: Array<{
      id: number;
      name: string;
      artist?: { name: string };
    }>;
    artists?: Array<{ id: number; name: string }>;
    playlists?: Array<{ id: number; name: string }>;
  };
}

interface QQMusicSearchResp {
  code?: number;
  songs?: QMSong[];
}

/** 单平台的建议集合（不含 platform 字段） */
type SuggestSections = Omit<SuggestData, "platform">;

const EMPTY_SECTIONS: SuggestSections = { songs: [], albums: [], artists: [], playlists: [] };

const emptySuggest = (platform: Platform): SuggestData => ({ ...EMPTY_SECTIONS, platform });

const neteaseSuggest = async (word: string): Promise<SuggestSections> => {
  const res = await neteaseCall<NeteaseSuggestResp>("search_suggest", {
    keywords: word,
    type: "web",
  });
  const raw = res.result ?? {};
  return {
    songs: (raw.songs ?? []).map((song) => ({
      id: String(song.id),
      name: song.name,
      artist: (song.artists ?? [])
        .map((artist) => artist.name)
        .filter(Boolean)
        .join(" / "),
      album: song.album?.name,
      source: "netease",
    })),
    albums: (raw.albums ?? []).map((album) => ({
      id: String(album.id),
      name: album.name,
      subtitle: album.artist?.name,
      source: "netease",
    })),
    artists: (raw.artists ?? []).map((artist) => ({
      id: String(artist.id),
      name: artist.name,
      source: "netease",
    })),
    playlists: (raw.playlists ?? []).map((playlist) => ({
      id: String(playlist.id),
      name: playlist.name,
      source: "netease",
    })),
  };
};

const QQ_MUSIC_SUGGEST_LIMIT = 6;

const qqmusicSuggest = async (word: string): Promise<SuggestSections> => {
  const res = await qqmusicCall<QQMusicSearchResp>("search", {
    keywords: word,
    type: 0,
    page: 1,
    limit: QQ_MUSIC_SUGGEST_LIMIT,
  });
  return {
    ...EMPTY_SECTIONS,
    songs: (res?.songs ?? []).map((song) => {
      const track = qqSongToTrack(song);
      return {
        id: track.id,
        name: track.title,
        artist: track.artists
          .map((artist) => artist.name)
          .filter(Boolean)
          .join(" / "),
        album: track.album?.name,
        source: "qqmusic",
        track,
      };
    }),
  };
};

/**
 * 获取搜索建议
 * @param keyword - 关键词
 * @param platform - 目标平台；无建议接口的平台返回空集
 * @returns 分类建议；keyword 空 / 接口失败时返回空集
 */
export const getSearchSuggest = async (
  keyword: string,
  platform: Platform = "netease",
): Promise<SuggestData> => {
  const word = keyword.trim();
  if (!word) return emptySuggest(platform);
  if (platform === "netease") return { ...(await neteaseSuggest(word)), platform };
  if (platform === "qqmusic") return { ...(await qqmusicSuggest(word)), platform };
  return emptySuggest(platform);
};
