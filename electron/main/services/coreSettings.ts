import { store } from "@main/store";
import type { ConfigPath } from "@main/store/types";
import {
  setEqualizerBands,
  setEqualizerEnabled,
  setFadeDuration,
  setNormalizationEnabled,
  setPreampGain,
} from "@main/services/engine";
import { refreshPlaybackPreload } from "@main/services/playbackSession";
import { isCoreSettingPath, type CoreSettingsSnapshot } from "@shared/types/settings";

/** 应用 Core-owned setting 的运行时副作用。 */
const applyCoreSettingChange = (keyPath: string, value: unknown): void => {
  switch (keyPath) {
    case "player.songLevel":
    case "player.allowTrialPlay":
    case "player.preloadNextTrack":
      refreshPlaybackPreload();
      break;
    case "player.loudnessNormalization":
      setNormalizationEnabled(value as boolean);
      break;
    case "player.equalizer.enabled":
      setEqualizerEnabled(value as boolean);
      break;
    case "player.equalizer.bands":
      setEqualizerBands(value as number[]);
      break;
    case "player.equalizer.preamp":
      setPreampGain(value as number);
      break;
    case "player.fadeEnabled":
    case "player.fadeDuration":
      setFadeDuration(store.get("player.fadeEnabled") ? store.get("player.fadeDuration") : 0);
      break;
  }
};

/** 读取 Core Domain 持有的设置快照，不投影 Host / Control-local 配置。 */
export const getCoreSettingsSnapshot = (): CoreSettingsSnapshot => ({
  player: store.get("player"),
  library: store.get("library"),
  lyric: store.get("lyric"),
  localLyric: store.get("localLyric"),
  cache: store.get("cache"),
  download: store.get("download"),
  streaming: store.get("streaming"),
  system: {
    neteaseRealIp: store.get("system.neteaseRealIp"),
    networkProxy: store.get("system.networkProxy"),
    neteaseScrobbleEnabled: store.get("system.neteaseScrobbleEnabled"),
    neteaseScrobbleMode: store.get("system.neteaseScrobbleMode"),
  },
});

/**
 * 写入一项 Core Domain 设置。
 * @param keyPath - 相对 `SystemConfig` 的点号路径
 * @param value - 新配置值
 */
export const setCoreSetting = (keyPath: string, value: unknown): void => {
  if (!isCoreSettingPath(keyPath)) {
    throw new Error(`非 Core Settings 路径: ${keyPath}`);
  }
  store.set(keyPath as ConfigPath, value);
  applyCoreSettingChange(keyPath, value);
};
