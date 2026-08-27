import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";

/** 进入 Source Direct 前必须恢复的样本处理状态。 */
export type DirectEntryBlocker = "volume" | "normalization" | "equalizer" | "speed" | "pitch";

export interface DirectEntryState {
  volume: number;
  normalizationEnabled: boolean;
  equalizerEnabled: boolean;
  speed: number;
  pitch: number;
}

const F32_EPSILON = 1.1920928955078125e-7;

/** Diretta Target 继续占用 SPlayer 现有 output-device ID 空间。 */
export const isDirettaOutput = (deviceId: string | null | undefined): boolean =>
  deviceId?.startsWith("diretta:") === true;

/**
 * 返回阻止 Source Direct 进入的当前样本处理项。
 * 与 native `validate_direct_entry()` 保持同一约束，不自动修改任何用户设置。
 */
export const getDirectEntryBlockers = (state: DirectEntryState): DirectEntryBlocker[] => {
  const blockers: DirectEntryBlocker[] = [];
  if (Math.abs(state.volume - 1) > F32_EPSILON) blockers.push("volume");
  if (state.normalizationEnabled) blockers.push("normalization");
  if (state.equalizerEnabled) blockers.push("equalizer");
  if (Math.abs(state.speed - 1) > F32_EPSILON) blockers.push("speed");
  if (state.pitch !== 0) blockers.push("pitch");
  return blockers;
};

/** 从 SPlayer 现有 settings/status 读取 Source Direct entry 状态，不创建第二份状态。 */
export const getCurrentDirectEntryState = (): DirectEntryState => {
  const settings = useSettingsStore();
  const status = useStatusStore();
  return {
    volume: status.volume,
    normalizationEnabled: settings.system.player.loudnessNormalization ?? false,
    equalizerEnabled: settings.system.player.equalizer?.enabled ?? false,
    speed: status.speed,
    pitch: status.pitch,
  };
};

export const getCurrentDirectEntryBlockers = (): DirectEntryBlocker[] =>
  getDirectEntryBlockers(getCurrentDirectEntryState());

/** 当前持久化输出选择是否为 Diretta Source Direct。 */
export const isDirectOutputSelected = (): boolean =>
  isDirettaOutput(useSettingsStore().player.outputDevice);

/**
 * Direct 被选中后，UI 层锁定会改变样本的控制；native 拒绝仍是最终权威。
 * 这里只派生现有设置，不保存新的 Direct 状态。
 */
export const useDirectModeState = () => {
  const settings = useSettingsStore();
  const status = useStatusStore();
  const selected = computed(() => isDirettaOutput(settings.player.outputDevice));
  const blockers = computed(() =>
    getDirectEntryBlockers({
      volume: status.volume,
      normalizationEnabled: settings.system.player.loudnessNormalization ?? false,
      equalizerEnabled: settings.system.player.equalizer?.enabled ?? false,
      speed: status.speed,
      pitch: status.pitch,
    }),
  );
  return {
    selected,
    blockers,
    sampleControlsUnavailable: selected,
  };
};
