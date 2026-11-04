/** 歌曲列表排序字段 */
export type SortField =
  | "none"
  | "title"
  | "artist"
  | "album"
  | "path"
  | "duration"
  | "size"
  | "mtime"
  | "ctime"
  | "track";

/** 歌曲列表排序方向 */
export type SortOrder = "asc" | "desc";

export type SongSortScope =
  "songs" | "liked" | "history" | "artist" | "album" | "playlist" | "cloud";
export type SongListDensity = "normal" | "compact";
export type SongSortPreference = { field: SortField; order: SortOrder };
export type SongSortPreferences = Partial<Record<SongSortScope, SongSortPreference>>;

export const DEFAULT_SONG_SORT: SongSortPreference = { field: "none", order: "asc" };

const SONG_SORT_SCOPES: SongSortScope[] = [
  "songs",
  "liked",
  "history",
  "artist",
  "album",
  "playlist",
  "cloud",
];
const SONG_SORT_FIELDS: SortField[] = [
  "none",
  "title",
  "artist",
  "album",
  "path",
  "duration",
  "size",
  "mtime",
  "ctime",
  "track",
];

/** 不接受任意专辑/歌单 ID 作为偏好键，避免长期积累失效键值。 */
export const normalizeSongSortPreferences = (input: unknown): SongSortPreferences => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const record = input as Record<string, unknown>;
  const result: SongSortPreferences = {};
  for (const scope of SONG_SORT_SCOPES) {
    const preference = record[scope];
    if (!preference || typeof preference !== "object") continue;
    const { field, order } = preference as Record<string, unknown>;
    if (SONG_SORT_FIELDS.includes(field as SortField) && (order === "asc" || order === "desc")) {
      result[scope] = { field: field as SortField, order };
    }
  }
  return result;
};
