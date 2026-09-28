import { store } from "@main/store";
import type { AlsaPlaybackMode } from "@shared/types/settings";
import { isDirectAlsaHardwareOutput, isDirettaOutput } from "@shared/utils/outputDevice";

export const getAlsaPlaybackMode = (): AlsaPlaybackMode => store.get("player.alsaPlaybackMode");

export const isAlsaDirectOutput = (
  deviceId: string | null | undefined,
  mode: AlsaPlaybackMode = getAlsaPlaybackMode(),
): boolean => mode === "direct" && deviceId != null && isDirectAlsaHardwareOutput(deviceId);

export const isAlsaProcessedOutput = (
  deviceId: string | null | undefined,
  mode: AlsaPlaybackMode = getAlsaPlaybackMode(),
): boolean => mode === "processed" && deviceId != null && isDirectAlsaHardwareOutput(deviceId);

/** 本地 native Direct 输入契约：Diretta 固定 direct，ALSA 由显式模式决定。 */
export const isLocalDirectOutput = (deviceId: string | null | undefined): boolean =>
  isDirettaOutput(deviceId) || isAlsaDirectOutput(deviceId);

export const isLocalDirectOutputWithMode = (
  deviceId: string | null | undefined,
  mode: AlsaPlaybackMode,
): boolean => isDirettaOutput(deviceId) || isAlsaDirectOutput(deviceId, mode);

export const parseAlsaPlaybackMode = (value: unknown): AlsaPlaybackMode => {
  if (value === "direct" || value === "processed") return value;
  throw new Error("alsaPlaybackMode must be direct or processed");
};
