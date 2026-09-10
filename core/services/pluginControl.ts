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
import { pluginRegistry } from "@main/plugins/registry";
import { invokeMenu, resolveUrl } from "@main/plugins/router";
import { matchCover, matchLyric } from "@main/plugins/metadata";
import { fetchScript } from "@main/plugins/net";
import { publishCoreControlEvent } from "@main/services/coreControlEvents";

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Core 持有的插件列表。 */
export const listPlugins = (): PluginInfo[] => pluginRegistry.listInfo();

/** 从远端源码 URL 安装插件。 */
export const installPluginFromUrl = async (
  url: string,
): Promise<{ ok: boolean; id?: string; error?: string }> => {
  try {
    const source = await fetchScript(url);
    const info = await pluginRegistry.installFromSource(source);
    return { ok: true, id: info.manifest.id };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
};

/** 卸载插件。 */
export const uninstallPlugin = async (id: string): Promise<{ ok: boolean; error?: string }> => {
  try {
    await pluginRegistry.uninstall(id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
};

/** 启用或禁用插件。 */
export const setPluginEnabled = (id: string, enabled: boolean): Promise<void> =>
  pluginRegistry.setEnabled(id, enabled);

/** 更新插件声明过的用户设置。 */
export const setPluginSetting = (id: string, key: string, value: unknown): Promise<void> =>
  pluginRegistry.setSetting(id, key, value);

/** 检查插件更新。 */
export const checkPluginUpdate = async (
  id: string,
): Promise<{ ok: boolean; hasUpdate: boolean; plugin?: PluginInfo; error?: string }> => {
  try {
    return await pluginRegistry.checkUpdate(id);
  } catch (error) {
    return { ok: false, hasUpdate: false, error: errorText(error) };
  }
};

/** 应用已经检查到的插件更新。 */
export const applyPluginUpdate = async (
  id: string,
): Promise<{ ok: boolean; plugin?: PluginInfo; error?: string; fallbackUrl?: string }> => {
  const updateUrl = pluginRegistry.getUpdateUrl(id);
  if (!updateUrl) return { ok: false, error: "PLUGIN_NO_UPDATE_URL" };
  try {
    const source = await fetchScript(updateUrl);
    const plugin = await pluginRegistry.applyUpdateFromSource(id, source);
    return { ok: true, plugin };
  } catch (error) {
    return { ok: false, error: errorText(error), fallbackUrl: updateUrl };
  }
};

/** 通过唯一 Core pluginRegistry 解析插件播放 URL。 */
export const resolvePluginUrl = (args: PluginResolveUrlArgs): Promise<MusicUrlRes> =>
  resolveUrl(args);

/** 触发插件菜单动作。 */
export const invokePluginMenu = async (
  args: PluginInvokeMenuArgs,
): Promise<PluginInvokeMenuResult> => {
  try {
    const result = await invokeMenu(args);
    return {
      ok: true,
      toast: result?.toast,
      openUrl: result?.openUrl,
      copyText: result?.copyText,
    };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
};

/** 通过插件匹配歌词。 */
export const matchPluginLyric = async (
  args: PluginMatchLyricArgs,
): Promise<PluginMatchLyricResult> => {
  const data = await matchLyric(args);
  return data ? { ok: true, data } : { ok: false };
};

/** 通过插件匹配封面。 */
export const matchPluginCover = async (
  args: PluginMatchCoverArgs,
): Promise<PluginMatchCoverResult> => {
  const data = await matchCover(args);
  return data ? { ok: true, data } : { ok: false };
};

let statusBridgeInstalled = false;
const publishPluginStatus = (info: PluginInfo): void => {
  publishCoreControlEvent({ type: "pluginStatus", data: info });
};

/** 将 pluginRegistry 状态变化接入统一 CoreControlEvent。 */
export const registerPluginControlEvents = (): void => {
  if (statusBridgeInstalled) return;
  statusBridgeInstalled = true;
  pluginRegistry.on("status", publishPluginStatus);
};

/** 释放 Plugin Core event bridge，便于 Core 生命周期完整关闭。 */
export const unregisterPluginControlEvents = (): void => {
  if (!statusBridgeInstalled) return;
  statusBridgeInstalled = false;
  pluginRegistry.off("status", publishPluginStatus);
};
