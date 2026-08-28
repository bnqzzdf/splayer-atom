import type { Track } from "../types/player";

const DJ_KEYWORDS = ["DJ", "抖音", "0.9", "0.8", "网红", "车载", "热歌", "慢摇"];

/** 播放策略层统一使用的 DJ 关键词判定。 */
export const shouldSkipDjTrack = (track: Pick<Track, "title" | "artists">): boolean => {
  const title = (track.title || "").toUpperCase();
  const artistNames = (track.artists || [])
    .map((artist) => artist.name)
    .join(" ")
    .toUpperCase();
  const fullText = `${title} ${artistNames}`;
  return DJ_KEYWORDS.some((keyword) => fullText.includes(keyword.toUpperCase()));
};
