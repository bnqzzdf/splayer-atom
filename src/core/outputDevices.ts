import type { AudioDevice } from "@shared/types/player";
import { isDirectAlsaHardwareOutput } from "@shared/utils/outputDevice";

/** HDMI / DisplayPort HDA 端点默认不占用快捷输出列表；Core 仍保留完整硬件能力。 */
export const isDisplayAudioOutput = (device: Pick<AudioDevice, "name">): boolean =>
  /\b(?:HDMI|DisplayPort|Display Port)\b/i.test(device.name);

/** Web Control 只展示 Headless Core 可直接打开且适合日常选择的 ALSA 硬件端点。 */
export const filterWebSystemOutputs = (
  devices: AudioDevice[],
  selectedOutputId: string | null = null,
): AudioDevice[] => {
  const seen = new Set<string>();
  return devices.filter((device) => {
    if (!isDirectAlsaHardwareOutput(device.id)) return false;
    if (isDisplayAudioOutput(device) && device.id !== selectedOutputId) return false;
    const key = device.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** 按当前 Control Host presentation 投影同一份 Core output snapshot。 */
export const projectOutputDevices = (
  devices: AudioDevice[],
  webRemote: boolean,
  selectedOutputId: string | null = null,
): AudioDevice[] => {
  if (!webRemote) return devices;
  const diretta = devices
    .filter((device) => device.id.startsWith("diretta:"))
    .map((device) => ({ ...device, name: `${device.name} · Diretta` }));
  const upnp = devices.filter((device) => device.id.startsWith("upnp:"));
  return [...filterWebSystemOutputs(devices, selectedOutputId), ...diretta, ...upnp];
};
