import type { PlayerApi, PlayerStatus } from "@shared/types/player";
import { coreCommand, coreResult } from "./controlClient";

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
>;

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
};
