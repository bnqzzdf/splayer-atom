import type {
  MusicUrlRes,
  PluginInfo,
  PluginInvokeMenuArgs,
  PluginInvokeMenuResult,
  PluginMatchCoverArgs,
  PluginMatchCoverResult,
  PluginMatchLyricArgs,
  PluginMatchLyricResult,
  PluginResolveUrlArgs,
} from "@shared/types/plugin";
import { subscribeCoreControlEvent } from "./controlEventClient";
import { request } from "./controlClient";

const post = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** Web Control 的 Core Plugin client。 */
export const pluginClient = {
  list: (): Promise<PluginInfo[]> => request<PluginInfo[]>("/plugins"),
  installFromUrl: (url: string): Promise<{ ok: boolean; id?: string; error?: string }> =>
    post("/plugins/install-url", { url }),
  uninstall: (id: string): Promise<{ ok: boolean; error?: string }> =>
    post(`/plugins/${encodeURIComponent(id)}/uninstall`),
  setEnabled: async (id: string, enabled: boolean): Promise<void> => {
    await post(`/plugins/${encodeURIComponent(id)}/enabled`, { enabled });
  },
  setSetting: async (id: string, key: string, value: unknown): Promise<void> => {
    await post(`/plugins/${encodeURIComponent(id)}/setting`, { key, value });
  },
  checkUpdate: (
    id: string,
  ): Promise<{ ok: boolean; hasUpdate: boolean; plugin?: PluginInfo; error?: string }> =>
    post(`/plugins/${encodeURIComponent(id)}/check-update`),
  applyUpdate: (
    id: string,
  ): Promise<{ ok: boolean; plugin?: PluginInfo; error?: string; fallbackUrl?: string }> =>
    post(`/plugins/${encodeURIComponent(id)}/apply-update`),
  resolveUrl: (args: PluginResolveUrlArgs): Promise<MusicUrlRes> =>
    post("/plugins/resolve-url", args),
  invokeMenu: (args: PluginInvokeMenuArgs): Promise<PluginInvokeMenuResult> =>
    post("/plugins/invoke-menu", args),
  matchLyric: (args: PluginMatchLyricArgs): Promise<PluginMatchLyricResult> =>
    post("/plugins/match-lyric", args),
  matchCover: (args: PluginMatchCoverArgs): Promise<PluginMatchCoverResult> =>
    post("/plugins/match-cover", args),
  onStatus: (callback: (info: PluginInfo) => void): (() => void) =>
    subscribeCoreControlEvent("pluginStatus", callback),
};
