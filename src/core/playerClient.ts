import type { AudioDevice, IpcResponse, PlayerApi, PlayerStatus } from "@shared/types/player";
import { isWebRemote } from "@/runtime";
import { coreCommand, coreResult } from "./controlClient";
import { projectOutputDevices } from "./outputDevices";

type PlayerControlApi = Pick<
  PlayerApi,
  | "setVolume"
  | "getStatus"
  | "setFadeDuration"
  | "setNormalizationEnabled"
  | "setEqualizerEnabled"
  | "setEqualizerBands"
  | "setPreampGain"
  | "setSpeed"
  | "setPitch"
  | "setPitchSync"
  | "getOutputDevices"
  | "setOutputDevice"
>;

interface OutputSnapshot {
  selected: string | null;
  data: AudioDevice[];
}

const mapOutputResult = async (
  result: Promise<IpcResponse<OutputSnapshot>>,
): Promise<IpcResponse<AudioDevice[]>> => {
  const resolved = await result;
  if (!resolved.success) return { success: false, error: resolved.error };
  if (!resolved.data) return { success: false, error: "CORE_RESPONSE_MISSING_DATA" };
  return { success: true, data: projectOutputDevices(resolved.data.data, isWebRemote()) };
};

/**
 * renderer 对 Core player processing/status command 的协议投影。
 * 输出枚举、Direct staging 与事件订阅仍由后续独立切片迁移。
 */
export const playerClient: PlayerControlApi = {
  setVolume: (volume) => coreCommand("/volume", { volume }),
  getStatus: () => coreResult<PlayerStatus>("/status"),
  setFadeDuration: (durationMs) => coreCommand("/player/fade", { durationMs }),
  setNormalizationEnabled: (enabled) => coreCommand("/player/normalization", { enabled }),
  setEqualizerEnabled: (enabled) => coreCommand("/player/equalizer", { enabled }),
  setEqualizerBands: (bands) => coreCommand("/player/equalizer", { bands }),
  setPreampGain: (preamp) => coreCommand("/player/equalizer", { preamp }),
  setSpeed: (speed) => coreCommand("/player/speed", { speed }),
  setPitch: (semitones) => coreCommand("/player/pitch", { semitones }),
  setPitchSync: (enabled) => coreCommand("/player/pitch-sync", { enabled }),
  getOutputDevices: () => mapOutputResult(coreResult<OutputSnapshot>("/output/devices")),
  setOutputDevice: (deviceId) => coreCommand("/output/select", { deviceId }),
};
