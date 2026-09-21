import type {
  AudioDevice,
  FftData,
  IpcResponse,
  PlayerApi,
  PlayerStatus,
} from "@shared/types/player";
import { coreCommand, coreResult } from "./controlClient";
import { projectOutputDevices } from "./outputDevices";
import type { AlsaPlaybackMode } from "@shared/types/settings";

type PlayerControlApi = Pick<
  PlayerApi,
  | "setVolume"
  | "getStatus"
  | "setFftEnabled"
  | "getFftData"
  | "setFadeDuration"
  | "setNormalizationEnabled"
  | "setEqualizerEnabled"
  | "setEqualizerBands"
  | "setPreampGain"
  | "setSpeed"
  | "setPitch"
  | "setPitchSync"
  | "getCoverRaw"
  | "readLyricFile"
  | "getOutputDevices"
  | "setOutputDevice"
> & {
  getOutputSnapshot(): Promise<IpcResponse<OutputSnapshot>>;
  getAlsaPlaybackMode(): Promise<IpcResponse<AlsaPlaybackMode>>;
  setAlsaPlaybackMode(mode: AlsaPlaybackMode): Promise<IpcResponse>;
};

interface OutputSnapshot {
  selected: string | null;
  alsaPlaybackMode: AlsaPlaybackMode;
  data: AudioDevice[];
}

const mapOutputSnapshot = async (
  result: Promise<IpcResponse<OutputSnapshot>>,
): Promise<IpcResponse<OutputSnapshot>> => {
  const resolved = await result;
  if (!resolved.success) return { success: false, error: resolved.error };
  if (!resolved.data) return { success: false, error: "CORE_RESPONSE_MISSING_DATA" };
  return {
    success: true,
    data: {
      selected: resolved.data.selected,
      alsaPlaybackMode: resolved.data.alsaPlaybackMode,
      data: projectOutputDevices(resolved.data.data, resolved.data.selected),
    },
  };
};

/**
 * renderer 对 Core player request/command 的协议投影。
 * Direct staging 已完全收归 Core；事件订阅与 Host presentation 继续使用独立 transport。
 */
export const playerClient: PlayerControlApi = {
  setVolume: (volume) => coreCommand("/volume", { volume }),
  getStatus: () => coreResult<PlayerStatus>("/status"),
  setFftEnabled: (enabled) => coreCommand("/player/fft", { enabled }),
  getFftData: async () => {
    const result = await coreResult<{ data: FftData }>("/player/fft");
    return result.success && result.data
      ? { success: true, data: result.data.data }
      : { success: false, error: result.error ?? "CORE_RESPONSE_MISSING_DATA" };
  },
  setFadeDuration: (durationMs) => coreCommand("/player/fade", { durationMs }),
  setNormalizationEnabled: (enabled) => coreCommand("/player/normalization", { enabled }),
  setEqualizerEnabled: (enabled) => coreCommand("/player/equalizer", { enabled }),
  setEqualizerBands: (bands) => coreCommand("/player/equalizer", { bands }),
  setPreampGain: (preamp) => coreCommand("/player/equalizer", { preamp }),
  setSpeed: (speed) => coreCommand("/player/speed", { speed }),
  setPitch: (semitones) => coreCommand("/player/pitch", { semitones }),
  setPitchSync: (enabled) => coreCommand("/player/pitch-sync", { enabled }),
  getCoverRaw: async () => {
    const result = await coreResult<{ data: string | null }>("/player/cover");
    return result.success && result.data
      ? { success: true, data: result.data.data }
      : { success: false, error: result.error ?? "CORE_RESPONSE_MISSING_DATA" };
  },
  readLyricFile: async (filePath) => {
    const result = await coreResult<{ data: string }>("/player/read-lyric", {
      method: "POST",
      body: JSON.stringify({ path: filePath }),
    });
    return result.success && result.data
      ? { success: true, data: result.data.data }
      : { success: false, error: result.error ?? "CORE_RESPONSE_MISSING_DATA" };
  },
  getOutputSnapshot: () => mapOutputSnapshot(coreResult<OutputSnapshot>("/output/devices")),
  getAlsaPlaybackMode: async () => {
    const result = await coreResult<{ mode: AlsaPlaybackMode }>("/player/alsa-mode");
    return result.success && result.data
      ? { success: true, data: result.data.mode }
      : { success: false, error: result.error ?? "CORE_RESPONSE_MISSING_DATA" };
  },
  setAlsaPlaybackMode: (mode) => coreCommand("/player/alsa-mode", { mode }),
  getOutputDevices: async () => {
    const result = await mapOutputSnapshot(coreResult<OutputSnapshot>("/output/devices"));
    return result.success && result.data
      ? { success: true, data: result.data.data }
      : { success: false, error: result.error };
  },
  setOutputDevice: (deviceId) => coreCommand("/output/select", { deviceId }),
};
