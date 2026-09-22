export type CacheCategory =
  "covers" | "artists" | "backgrounds" | "songs" | "lyric" | "lyricTTML" | "lyricMatch";

export type CacheKind = "file" | "db";

export interface CacheStat {
  id: CacheCategory;
  kind: CacheKind;
  path: string;
  size: number;
}

export interface CacheSwitchResult {
  ok: boolean;
  dir: string;
  reason?: "notEmpty";
}
