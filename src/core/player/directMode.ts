import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import {
  isDirettaOutput,
  isSampleProcessingUnavailableOutput,
  isUpnpOutput,
} from "@shared/utils/outputDevice";
export { isDirettaOutput } from "@shared/utils/outputDevice";

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

export const isSampleProcessingUnavailableSelected = (): boolean =>
  isSampleProcessingUnavailableOutput(useSettingsStore().player.outputDevice);

/**
 * 输出模式被选中后，UI 层锁定不会作用于当前媒体路径的样本处理控制。
 * Diretta 的 entry blockers 仍只服务 Source Direct preflight；UPnP 不要求修改普通输出设置。
 */
export const useDirectModeState = () => {
  const settings = useSettingsStore();
  const status = useStatusStore();
  const selected = computed(() => isDirettaOutput(settings.player.outputDevice));
  const remoteSelected = computed(() => isUpnpOutput(settings.player.outputDevice));
  const blockers = computed(() =>
    getDirectEntryBlockers({
      volume: status.volume,
      normalizationEnabled: settings.system.player.loudnessNormalization ?? false,
      equalizerEnabled: settings.system.player.equalizer?.enabled ?? false,
      speed: status.speed,
      pitch: status.pitch,
    }),
  );
  const sampleControlsUnavailable = computed(() => selected.value || remoteSelected.value);
  return {
    selected,
    remoteSelected,
    blockers,
    sampleControlsUnavailable,
  };
};
