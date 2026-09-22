/**
 * 下载歌词解析
 *
 * 取歌曲歌词文本（用于内嵌到标签 / 写 .lrc）。来源在渲染层，因此在入队前解析好带给主进程。
 */

import type { Track } from "@shared/types/player";
import type { LyricFormat, LyricInput } from "@shared/types/lyrics";
import { isPlatform } from "@shared/types/platform";
import { buildDownloadLyric } from "@/utils/lyric/serialize";
import {
  isBetterFormat,
  isPluginLyricPreferred,
  resolveLocalRepoLyric,
  resolveOnlineByPreference,
  resolvePluginLyric,
  resolveStreamingByPreference,
  resolveTTMLOverlay,
  type OnlineResult,
  type ResolvedLyric,
} from "@/services/lyric/resolve";

/** 下载用歌词 */
export interface DownloadLyric extends LyricInput {
  format: LyricFormat;
}

/** 转为下载歌词结构 */
const toDownloadLyric = (lyric: ResolvedLyric): DownloadLyric => ({
  format: lyric.source.format,
  ...lyric.input,
});

/** 判断候选歌词是否能被下载序列化使用 */
const toUsableDownloadLyric = (lyric: ResolvedLyric | null): DownloadLyric | null => {
  if (!lyric) return null;
  const downloadLyric = toDownloadLyric(lyric);
  try {
    const hasContent =
      buildDownloadLyric(downloadLyric, downloadLyric.format, "lrc") ||
      buildDownloadLyric(downloadLyric, downloadLyric.format, "ttml");
    return hasContent ? downloadLyric : null;
  } catch {
    return null;
  }
};

/** 在线歌词优先尝试 TTML，失败再回落原结果 */
const resolveOnlineDownloadLyric = async (
  track: Track,
  online: OnlineResult | null,
): Promise<DownloadLyric | null> => {
  if (!online) return null;
  let ttml: ResolvedLyric | null = null;
  try {
    ttml = await resolveTTMLOverlay(track, online);
  } catch {
    // 下载仍以基础歌词兜底，TTML 网络失败不能使整个下载失败。
  }
  return (
    toUsableDownloadLyric(ttml) ??
    toUsableDownloadLyric({ source: online.source, input: online.input })
  );
};

/** 流媒体在线候选在下载前同步完成 TTML 决议 */
const resolveStreamingDownloadLyric = async (
  track: Track,
  lyric: ResolvedLyric | null,
): Promise<DownloadLyric | null> => {
  if (!lyric) return null;
  if (lyric.source.source === "online" && lyric.source.platform) {
    return resolveOnlineDownloadLyric(track, {
      source: {
        source: "online",
        format: lyric.source.format,
        platform: lyric.source.platform,
      },
      input: lyric.input,
    });
  }
  return toUsableDownloadLyric(lyric);
};

/**
 * 取歌曲歌词文本
 * @param track - 歌曲
 * @returns 歌词文本与格式；无歌词返回 null
 */
export const resolveDownloadLyric = async (track: Track): Promise<DownloadLyric | null> => {
  const local = toUsableDownloadLyric(await resolveLocalRepoLyric(track));
  if (local) return local;

  // 流媒体
  if (track.source === "streaming") {
    // 插件优选：请求先行发出，与正常来源并发
    const pluginTask = isPluginLyricPreferred() ? resolvePluginLyric(track) : null;
    const streaming = await resolveStreamingDownloadLyric(
      track,
      await resolveStreamingByPreference(track),
    );
    if (pluginTask) {
      const plugin = toUsableDownloadLyric(await pluginTask);
      if (plugin && isBetterFormat(plugin.format, streaming?.format ?? null)) return plugin;
      return streaming ?? plugin ?? null;
    }
    return streaming ?? toUsableDownloadLyric(await resolvePluginLyric(track));
  }

  // 在线平台
  if (isPlatform(track.source)) {
    // 插件优选：请求先行发出，与正常来源并发
    const pluginTask = isPluginLyricPreferred() ? resolvePluginLyric(track) : null;
    const online = await resolveOnlineByPreference(track, { hasLocal: false, localFormat: null });
    const onlineLyric = await resolveOnlineDownloadLyric(track, online);
    if (pluginTask) {
      const plugin = toUsableDownloadLyric(await pluginTask);
      if (plugin && isBetterFormat(plugin.format, onlineLyric?.format ?? null)) return plugin;
      return onlineLyric ?? plugin ?? null;
    }
    return onlineLyric ?? toUsableDownloadLyric(await resolvePluginLyric(track));
  }

  return null;
};
