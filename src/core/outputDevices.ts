import type { AudioDevice } from "@shared/types/player";
import { isDirectAlsaHardwareOutput } from "@shared/utils/outputDevice";

export type OutputKind = "alsa" | "diretta" | "upnp";

/** Control presentation only: classify one canonical Core output id. */
export const getOutputKind = (deviceId: string | null | undefined): OutputKind | null => {
  if (!deviceId) return null;
  if (deviceId.startsWith("diretta:")) return "diretta";
  if (deviceId.startsWith("upnp:")) return "upnp";
  if (deviceId.startsWith("alsa:")) return "alsa";
  return null;
};

/** 清理驱动和协议附加信息，只保留用户识别设备所需的名称。 */
export const getOutputDisplayName = (device: Pick<AudioDevice, "id" | "name">): string =>
  device.name
    .replace(/^HD-Audio Generic\s*[-,]\s*/i, "")
    .replace(/\s*[-–—]\s*USB Audio$/i, "")
    .replace(/\s*·\s*Diretta$/i, "")
    .trim();

/** 返回同名 Diretta Target 在当前列表中的简短路径序号。 */
export const getOutputPathIndex = (
  device: Pick<AudioDevice, "id" | "name">,
  devices: readonly Pick<AudioDevice, "id" | "name">[],
): number | null => {
  if (getOutputKind(device.id) !== "diretta") return null;
  const sameName = devices.filter(
    (candidate) =>
      getOutputKind(candidate.id) === "diretta" &&
      getOutputDisplayName(candidate) === getOutputDisplayName(device),
  );
  if (sameName.length < 2) return null;
  const index = sameName.findIndex((candidate) => candidate.id === device.id);
  return index >= 0 ? index + 1 : null;
};

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

/** 为 Web Control 投影同一份 Core output snapshot。 */
export const projectOutputDevices = (
  devices: AudioDevice[],
  selectedOutputId: string | null = null,
): AudioDevice[] => {
  const projected = devices.map((device) => ({
    ...device,
    name: getOutputDisplayName(device),
  }));
  const diretta = projected.filter((device) => device.id.startsWith("diretta:"));
  const upnp = projected.filter((device) => device.id.startsWith("upnp:"));
  return [...filterWebSystemOutputs(projected, selectedOutputId), ...diretta, ...upnp];
};
