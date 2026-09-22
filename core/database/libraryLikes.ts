import { getDb } from "./index";

/** 返回仍存在于本地曲库中的红心曲目 ID，按最近收藏倒序。 */
export const getLibraryLikedTrackIds = (): string[] =>
  (
    getDb()
      .prepare(
        `SELECT l.track_id
         FROM library_likes l
         INNER JOIN tracks t ON t.id = l.track_id
         ORDER BY l.liked_at DESC`,
      )
      .all() as { track_id: string }[]
  ).map((row) => row.track_id);

/** 写入一首本地曲目的红心状态。 */
export const setLibraryTrackLiked = (trackId: string, liked: boolean): void => {
  if (!trackId) throw new Error("trackId_required");
  const exists = getDb().prepare("SELECT 1 FROM tracks WHERE id = ?").get(trackId);
  if (!exists) throw new Error("LIBRARY_TRACK_NOT_FOUND");
  if (liked) {
    getDb()
      .prepare(
        `INSERT INTO library_likes (track_id, liked_at) VALUES (?, ?)
         ON CONFLICT(track_id) DO UPDATE SET liked_at = excluded.liked_at`,
      )
      .run(trackId, Date.now());
  } else {
    getDb().prepare("DELETE FROM library_likes WHERE track_id = ?").run(trackId);
  }
};

/** 并集合并旧 Web Control 的红心 ID；无效/已删除曲目自动忽略。 */
export const importLibraryLikedTrackIds = (trackIds: string[]): void => {
  const insert = getDb().prepare(
    `INSERT OR IGNORE INTO library_likes (track_id, liked_at)
     SELECT id, ? FROM tracks WHERE id = ?`,
  );
  const now = Date.now();
  getDb().transaction((ids: string[]) => {
    ids.forEach((trackId, index) => insert.run(now - index, trackId));
  })([...new Set(trackIds.filter(Boolean))]);
};
