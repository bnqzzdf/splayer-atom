import type { PlayerOutputPath, PlayerOutputStatus } from "@shared/types/player";
import { isDirectAlsaHardwareOutput } from "@shared/utils/outputDevice";

type AudioEngineModule = typeof import("@splayer/audio-engine");
type PlayerInstance = InstanceType<AudioEngineModule["AudioPlayer"]>;

const nativeOutputPath = (value: string | null | undefined): PlayerOutputPath => {
  switch (value) {
    case "exact-pcm":
    case "native-dsd":
    case "decoded-pcm":
    case "processed-pcm":
      return value;
    default:
      return null;
  }
};

/** 从已提交 runtime 与唯一 ALSA 偏好纯派生输出能力，不保存第二份模式状态。 */
export const projectNativeOutputStatus = (player: PlayerInstance): PlayerOutputStatus => {
  const deviceId = player.getSelectedDeviceName() ?? null;
  const native = player.getStatus();
  const path = nativeOutputPath(native.outputPath);
  const sampleProcessingAvailable =
    path === "processed-pcm" ||
    (path === null &&
      deviceId !== null &&
      isDirectAlsaHardwareOutput(deviceId) &&
      player.getAlsaPlaybackMode() === "processed");
  return {
    deviceId,
    path,
    sampleProcessingAvailable,
    fftAvailable: native.fftAvailable === true,
  };
};

/** Direct 路径只投影实际生效的本地控制值；保存的 processed 参数仍只存在 settings。 */
export const projectNativeEffectiveControls = (player: PlayerInstance) => {
  const output = projectNativeOutputStatus(player);
  return {
    output,
    volume: output.sampleProcessingAvailable ? player.getVolume() : 1,
    speed: output.sampleProcessingAvailable ? player.getSpeed() : 1,
  };
};
