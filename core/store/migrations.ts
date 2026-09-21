import type { SystemConfig } from "@shared/types/settings";

export interface Migration {
  /** 版本号，递增整数 */
  version: number;
  /** 迁移函数，直接修改 data 对象 */
  migrate: (data: SystemConfig) => void;
}

/**
 * 迁移列表，按 version 递增排列
 * 新增字段已由 deepMerge 自动补全，此处仅用于字段重命名、数据转换等
 */
export const migrations: Migration[] = [
  {
    version: 2,
    migrate: (data) => {
      const scheme = data.download.folderScheme as string;
      if (scheme === "artist" || scheme === "artist-album") {
        data.download.folderScheme = "album";
      }
    },
  },
  {
    version: 3,
    migrate: (data) => {
      // 旧版本所有 ALSA 播放都经过现有 PCM/DSP 路径；升级时必须保持这一用户意图。
      data.player.alsaPlaybackMode = "processed";
      const output = data.player.outputDevice;
      const canonicalOutput =
        output == null ||
        /^alsa:hw:CARD=[A-Za-z_][^,]*,DEV=\d+$/.test(output) ||
        output.startsWith("diretta:") ||
        output.startsWith("upnp:");
      if (!canonicalOutput) {
        // CPAL DeviceId/显示名/default/plughw 都不是新的持久化 HW 身份；升级后要求重新选择。
        data.player.outputDevice = null;
      }
    },
  },
];
