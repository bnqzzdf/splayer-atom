import type { AudioDevice } from "@shared/types/player";

/** Web Control 只展示系统默认与真实 ALSA hw 声卡。 */
export const filterWebSystemOutputs = (devices: AudioDevice[]): AudioDevice[] => {
  const seen = new Set<string>();
  return devices.filter((device) => {
    if (device.id.startsWith("diretta:")) return false;
    if (
      device.id.startsWith("alsa:") &&
      !device.isDefault &&
      !/^alsa:hw:CARD=[A-Za-z_][^,]*,DEV=\d+$/.test(device.id)
    ) {
      return false;
    }
    const key = device.isDefault ? `default:${device.id}` : device.name.trim().toLowerCase();
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
