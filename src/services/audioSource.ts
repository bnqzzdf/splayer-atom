import type { Track } from "@shared/types/player";
import { buildPluginPlaybackMusicInfo, pluginPlaybackSource } from "@shared/utils/pluginPlayback";
import type { QualityLevel } from "@/utils/quality";
import { usePluginsStore } from "@/stores/plugins";
import { ErrorCode } from "@shared/types/errors";
import { pluginClient } from "@/core/pluginClient";

/** 插件 URL 解析结果，仅用于下载兼容路径；实际播放源始终由 Core 解析。 */
export type OnlineResolveResult =
  | {
      ok: true;
      url: string;
      isTrial: false;
      provider: "plugin";
      pluginId: string;
    }
  | { ok: false; errorCode: ErrorCode };

/**
 * 经插件解析在线音频 URL。
 * @param track - 要解析的曲目
 * @param quality - 下载音质档位
 * @param skipPluginIds - 要跳过的插件 ID
 * @returns 插件解析结果
 */
export const resolveByPlugin = async (
  track: Track,
  quality: QualityLevel = "hq",
  skipPluginIds: readonly string[] = [],
): Promise<OnlineResolveResult> => {
  const fail = (errorCode: ErrorCode): OnlineResolveResult => ({ ok: false, errorCode });
  const pluginSource = pluginPlaybackSource(track.source);
  if (!pluginSource) return fail(ErrorCode.URL_RESOLVE_FAILED);

  const skip = new Set(skipPluginIds);
  const candidates = usePluginsStore().list.filter(
    (info) =>
      !skip.has(info.manifest.id) &&
      info.enabled &&
      info.status.state === "ready" &&
      info.status.sources[pluginSource]?.actions.includes("musicUrl"),
  );
  if (candidates.length === 0) return fail(ErrorCode.NO_PLUGIN_AVAILABLE);

  const musicInfo = buildPluginPlaybackMusicInfo(track, pluginSource);
  for (const plugin of candidates) {
    try {
      const result = await pluginClient.resolveUrl({
        pluginId: plugin.manifest.id,
        source: pluginSource,
        quality,
        musicInfo,
      });
      if (result?.url) {
        return {
          ok: true,
          url: result.url,
          isTrial: false,
          provider: "plugin",
          pluginId: plugin.manifest.id,
        };
      }
    } catch (error) {
      console.warn("[plugin] resolveUrl failed", plugin.manifest.id, error);
    }
  }
  return fail(ErrorCode.URL_RESOLVE_FAILED);
};
