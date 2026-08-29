import fs from "node:fs/promises";
import { deleteTracksByPaths, getAllTracks, getTracksByIds, upsertTracks } from "@main/database";
import { scannedToUpsert } from "@main/services/scanner";
import { getEngine } from "@main/services/engine";
import { fetchBytes } from "@main/utils/fetchBytes";
import { getCoverCacheDir } from "@main/utils/config";
import { libraryLog } from "@main/utils/logger";
import type { JsTagWriteRequest } from "@splayer/audio-engine";
import type { TrackTags, TagEditRequest, TagWriteOutcome } from "@shared/types/tagEditor";

const knownLibraryPaths = (): Set<string> =>
  new Set(
    getAllTracks()
      .map((track) => track.path)
      .filter(
        (filePath): filePath is string => typeof filePath === "string" && filePath.length > 0,
      ),
  );

const assertKnownLibraryPath = (filePath: string): void => {
  if (!knownLibraryPaths().has(filePath)) throw new Error("LIBRARY_FILE_NOT_FOUND");
};

/** 读取 Core library 已知本地文件的标签。 */
export const readLibraryTags = async (filePath: string): Promise<TrackTags> => {
  assertKnownLibraryPath(filePath);
  return getEngine().readTrackTags(filePath);
};

/** 写入 Core library 已知文件标签并刷新数据库投影。 */
export const writeLibraryTags = async (edits: TagEditRequest[]): Promise<TagWriteOutcome[]> => {
  const known = knownLibraryPaths();
  if (edits.some((edit) => !known.has(edit.path))) throw new Error("LIBRARY_FILE_NOT_FOUND");

  const requests: JsTagWriteRequest[] = [];
  const replacedCovers = new Set<string>();
  for (const edit of edits) {
    const { coverPath, coverUrl, ...fields } = edit;
    let cover: Buffer | undefined;
    if (coverPath) {
      cover = await fs.readFile(coverPath);
    } else if (coverUrl) {
      cover = (await fetchBytes(coverUrl, { requireImage: true })) ?? undefined;
      if (!cover) libraryLog.warn(`封面下载失败，跳过封面只写文本: ${coverUrl}`);
    }
    if (cover) replacedCovers.add(edit.path);
    requests.push({ ...fields, cover });
  }

  const results = await getEngine().writeTrackTags(requests, getCoverCacheDir());
  const upserts = results
    .filter((result) => result.success && result.track)
    .map((result) => {
      const upsert = scannedToUpsert(result.track!);
      if (upsert.cover && replacedCovers.has(upsert.path)) {
        upsert.cover = `${upsert.cover}?v=${upsert.mtime}`;
      }
      return upsert;
    });
  if (upserts.length > 0) upsertTracks(upserts);

  const tracks = getTracksByIds(upserts.map((upsert) => upsert.id));
  const byPath = new Map(tracks.map((track) => [track.path, track]));
  libraryLog.info(`标签写入完成: ${upserts.length}/${results.length} 成功`);
  return results.map((result) => ({
    path: result.path,
    success: result.success,
    error: result.error ?? undefined,
    track: byPath.get(result.path),
  }));
};

/** 删除 Core library 已知曲目文件并同步数据库。未知路径按失败处理，不执行 unlink。 */
export const deleteLibraryFiles = async (
  paths: string[],
): Promise<{ deleted: number; failed: number }> => {
  const known = knownLibraryPaths();
  const failed: string[] = [];
  const deleted: string[] = [];
  for (const filePath of paths) {
    if (!known.has(filePath)) {
      failed.push(filePath);
      continue;
    }
    try {
      await fs.unlink(filePath);
      deleted.push(filePath);
    } catch {
      failed.push(filePath);
    }
  }
  if (deleted.length > 0) deleteTracksByPaths(deleted);
  libraryLog.info(`删除 ${deleted.length} 个文件，${failed.length} 个失败`);
  return { deleted: deleted.length, failed: failed.length };
};
