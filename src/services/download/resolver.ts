/**
 * 下载附带歌词准备服务。
 *
 * Control 在任务入队前按当前歌词偏好固化文本；音频源由 Core 在真正执行任务时解析，
 * 因此临时 URL 不进入 Control 权威态，任务入队后也不再依赖 Control 存活。
 */
import type { DownloadRequest } from "@shared/types/download";
import { resolveDownloadLyric } from "@/services/download/lyric";
import { buildDownloadLyric } from "@/utils/lyric/serialize";

/**
 * 按当前 Control 的歌词偏好准备下载附带文本；音频源仍由 Core 在任务执行时解析。
 * @param payload - 下载任务参数
 * @returns 可直接持久化进 Core 下载任务的歌词字段
 */
export const prepareDownloadLyrics = async (
  payload: Pick<DownloadRequest, "track" | "tagOptions" | "lyricFileFormat">,
): Promise<Pick<DownloadRequest, "lyricText" | "ttmlText">> => {
  const { tagOptions } = payload;
  let lyricText: string | undefined;
  let ttmlText: string | undefined;
  if (tagOptions.embedLyric || tagOptions.writeLrc || tagOptions.saveTtml) {
    const lyric = await resolveDownloadLyric(payload.track);
    if (lyric) {
      const input = {
        content: lyric.content,
        translation: lyric.translation,
        translationFormat: lyric.translationFormat,
        romaji: lyric.romaji,
        romajiFormat: lyric.romajiFormat,
      };
      // 内嵌与 .lrc 文件共用所选格式（lrc/增强 LRC）
      if (tagOptions.embedLyric || tagOptions.writeLrc) {
        lyricText = buildDownloadLyric(input, lyric.format, payload.lyricFileFormat) ?? undefined;
      }
      // 完整 TTML 单独导出
      if (tagOptions.saveTtml) {
        ttmlText = buildDownloadLyric(input, lyric.format, "ttml") ?? undefined;
      }
    }
  }
  return { lyricText, ttmlText };
};
