import { store } from "@main/store";
import type { ConfigPath } from "@main/store/types";
import {
  setEqualizerBands,
  setEqualizerEnabled,
  setFadeDuration,
  setClippingProtectionEnabled,
  setNormalizationEnabled,
  setPreampGain,
} from "@main/services/engine";
import {
  assertSampleProcessingAvailable,
  refreshPlaybackPreload,
} from "@main/services/playbackSession";
import { applyListenBrainzSettingChange } from "@main/services/listenbrainz";
import { isCoreSettingPath, type CoreSettingsSnapshot } from "@shared/types/settings";

const SAMPLE_PROCESSING_SETTING_PATHS = new Set([
  "player.loudnessNormalization",
  "player.clippingProtection",
  "player.equalizer.enabled",
  "player.equalizer.bands",
  "player.equalizer.preamp",
  "player.fadeEnabled",
  "player.fadeDuration",
]);

/** 样本处理设置先提交给 native；失败时绝不能先污染 durable setting。 */
const applySampleProcessingChange = (keyPath: string, value: unknown): void => {
  switch (keyPath) {
    case "player.loudnessNormalization":
      setNormalizationEnabled(value as boolean);
      break;
    case "player.clippingProtection":
      setClippingProtectionEnabled(value as boolean);
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
      setFadeDuration(value === true ? store.get("player.fadeDuration") : 0);
      break;
    case "player.fadeDuration":
      setFadeDuration(store.get("player.fadeEnabled") ? Number(value) : 0);
      break;
  }
};

/** 应用 Core-owned setting 的运行时副作用。 */
const applyCoreSettingChange = (keyPath: string): void => {
  switch (keyPath) {
    case "player.songLevel":
    case "player.allowTrialPlay":
    case "player.preloadNextTrack":
      refreshPlaybackPreload();
      break;
    case "listenbrainz.enabled":
    case "listenbrainz.sendNowPlaying":
      applyListenBrainzSettingChange(keyPath);
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
  listenbrainz: store.get("listenbrainz"),
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
  if (SAMPLE_PROCESSING_SETTING_PATHS.has(keyPath)) {
    assertSampleProcessingAvailable();
    applySampleProcessingChange(keyPath, value);
    store.set(keyPath as ConfigPath, value);
    return;
  }
  store.set(keyPath as ConfigPath, value);
  applyCoreSettingChange(keyPath);
};
