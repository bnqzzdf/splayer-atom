import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import {
  isDirectAlsaHardwareOutput,
  isDirettaOutput,
  isUpnpOutput,
} from "@shared/utils/outputDevice";
import type { AlsaPlaybackMode } from "@shared/types/settings";
export { isDirettaOutput } from "@shared/utils/outputDevice";

export const isAlsaDirectOutput = (
  deviceId: string | null | undefined,
  mode: AlsaPlaybackMode,
): boolean => mode === "direct" && deviceId != null && isDirectAlsaHardwareOutput(deviceId);

/** 当前 Core 投影是否选择了本地 Direct 路径。 */
export const isDirectOutputSelected = (): boolean => {
  const settings = useSettingsStore();
  const deviceId = settings.player.outputDevice;
  return (
    isDirettaOutput(deviceId) ||
    isAlsaDirectOutput(deviceId, settings.system.player.alsaPlaybackMode)
  );
};

export const isSampleProcessingUnavailableSelected = (): boolean => {
  const settings = useSettingsStore();
  const status = useStatusStore();
  if (
    status.output.deviceId === settings.player.outputDevice &&
    settings.player.outputDevice !== null
  ) {
    return !status.output.sampleProcessingAvailable;
  }
  return isUpnpOutput(settings.player.outputDevice) || isDirectOutputSelected();
};

export const isAlsaHardwareOutputSelected = (): boolean => {
  const deviceId = useSettingsStore().player.outputDevice;
  return deviceId != null && isDirectAlsaHardwareOutput(deviceId);
};

/**
 * 输出模式被选中后，UI 层只投影 Core 的处理能力；保存的 processed 参数始终保持休眠。
 */
export const useDirectModeState = () => {
  const settings = useSettingsStore();
  const status = useStatusStore();
  const direttaSelected = computed(() => isDirettaOutput(settings.player.outputDevice));
  const alsaDirectSelected = computed(() =>
    isAlsaDirectOutput(settings.player.outputDevice, settings.system.player.alsaPlaybackMode),
  );
  const selected = computed(() => direttaSelected.value || alsaDirectSelected.value);
  const remoteSelected = computed(() => isUpnpOutput(settings.player.outputDevice));
  const sampleControlsUnavailable = computed(() => {
    if (
      status.output.deviceId === settings.player.outputDevice &&
      settings.player.outputDevice !== null
    ) {
      return !status.output.sampleProcessingAvailable;
    }
    return selected.value || remoteSelected.value;
  });
  return {
    selected,
    direttaSelected,
    alsaDirectSelected,
    remoteSelected,
    sampleControlsUnavailable,
  };
};
