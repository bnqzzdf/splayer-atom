import type { AudioDevice } from "../types/player";

const DIRECT_ALSA_HARDWARE_ID = /^alsa:hw:CARD=[A-Za-z_][^,]*,DEV=\d+$/;

/** 是否为 Atom 的 Diretta Source Direct 输出身份。 */
export const isDirettaOutput = (deviceId: string | null | undefined): boolean =>
  deviceId?.startsWith("diretta:") === true;

/** 是否为 Atom 的 UPnP Renderer 输出身份。 */
export const isUpnpOutput = (deviceId: string | null | undefined): boolean =>
  deviceId?.startsWith("upnp:") === true;

/** 当前输出是否不消费 Core 的本地 sample-processing pipeline。 */
export const isSampleProcessingUnavailableOutput = (deviceId: string | null | undefined): boolean =>
  isDirettaOutput(deviceId) || isUpnpOutput(deviceId);

/** 是否为可由 Headless Core 直接打开的命名 ALSA 硬件端点。 */
export const isDirectAlsaHardwareOutput = (deviceId: string): boolean =>
  DIRECT_ALSA_HARDWARE_ID.test(deviceId);

/** 仅在候选唯一时返回首次启动可安全自动选择的 ALSA 硬件端点。 */
export const selectInitialHeadlessOutput = (
  devices: readonly Pick<AudioDevice, "id">[],
): string | null => {
  const candidates = new Set(devices.map((device) => device.id).filter(isDirectAlsaHardwareOutput));
  return candidates.size === 1 ? (candidates.values().next().value ?? null) : null;
};
