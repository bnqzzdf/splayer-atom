import type {
  DailyPlayStats,
  FavoriteEventInput,
  HourlyPlayStats,
  LibraryStats,
  PlayStatsSummary,
  StatsApi,
  TopAlbum,
  TopArtist,
  TopTrack,
} from "@shared/types/stats";
import type { Track } from "@shared/types/player";
import { controlAssetUrl, serverAssetUrl } from "./controlAssets";
import { request } from "./controlClient";

const mapTrack = (track: Track): Track => ({
  ...track,
  cover: controlAssetUrl(track.cover),
  coverOriginal: controlAssetUrl(track.coverOriginal),
});

const toServerTrack = (track: Track): Track => ({
  ...track,
  cover: serverAssetUrl(track.cover),
  coverOriginal: serverAssetUrl(track.coverOriginal),
});

const recordFavorite = (event: FavoriteEventInput): void => {
  void request("/stats/favorite", {
    method: "POST",
    body: JSON.stringify({ ...event, track: toServerTrack(event.track) }),
  });
};

/** Web Control 的 Core Stats request client。播放计数由 Core native lifecycle 独立拥有。 */
export const statsClient: StatsApi = {
  recordFavorite,
  getStatsSummary: () => request<PlayStatsSummary>("/stats/summary"),
  getTopTracks: async (limit) =>
    (await request<TopTrack[]>(`/stats/top-tracks?limit=${limit}`)).map((item) => ({
      ...item,
      track: mapTrack(item.track),
    })),
  getLibraryStats: () => request<LibraryStats>("/stats/library"),
  getPlayHistoryDaily: (days) => request<DailyPlayStats[]>(`/stats/daily?days=${days}`),
  getPlayHistoryHourly: () => request<HourlyPlayStats[]>("/stats/hourly"),
  getTopAlbums: async (limit) =>
    (await request<TopAlbum[]>(`/stats/top-albums?limit=${limit}`)).map((item) => ({
      ...item,
      track: mapTrack(item.track),
    })),
  getTopArtists: async (limit) =>
    (await request<TopArtist[]>(`/stats/top-artists?limit=${limit}`)).map((item) => ({
      ...item,
      track: mapTrack(item.track),
    })),
};
