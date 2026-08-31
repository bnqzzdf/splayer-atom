import type { AudioDevice } from "@shared/types/player";
import { isDirectAlsaHardwareOutput } from "@shared/utils/outputDevice";

/** Web Control 只展示 Headless Core 可直接打开的真实 ALSA 硬件端点。 */
export const filterWebSystemOutputs = (devices: AudioDevice[]): AudioDevice[] => {
  const seen = new Set<string>();
  return devices.filter((device) => {
    if (!isDirectAlsaHardwareOutput(device.id)) return false;
    const key = device.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** 按当前 Control Host presentation 投影同一份 Core output snapshot。 */
export const projectOutputDevices = (devices: AudioDevice[], webRemote: boolean): AudioDevice[] => {
  if (!webRemote) return devices;
  const diretta = devices
    .filter((device) => device.id.startsWith("diretta:"))
    .map((device) => ({ ...device, name: `${device.name} · Diretta` }));
  return [...filterWebSystemOutputs(devices), ...diretta];
};
