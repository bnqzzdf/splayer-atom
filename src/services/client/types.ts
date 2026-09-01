import type {
  PlayerApi,
  PlayerEvent,
  PlayerState,
  PlayerStatus,
  LoadOptions,
  LoadResult,
  Track,
  AudioQuality,
  IpcResponse,
  AudioDevice,
  FftData,
} from "@shared/types/player";

export type {
  PlayerApi,
  PlayerEvent,
  PlayerState,
  PlayerStatus,
  LoadOptions,
  LoadResult,
  Track,
  AudioQuality,
  IpcResponse,
  AudioDevice,
  FftData,
};

export type ClientMode = "electron" | "http";

export interface IPlayerClient extends Pick<
  PlayerApi,
  | "load"
  | "play"
  | "pause"
  | "stop"
  | "seek"
  | "setVolume"
  | "setPauseOnDeviceSwitch"
  | "getVolume"
  | "getStatus"
  | "setFftEnabled"
  | "getFftData"
  | "setFadeDuration"
  | "getFadeDuration"
  | "getCoverRaw"
  | "readLyricFile"
  | "reinit"
  | "setNormalizationEnabled"
  | "setEqualizerEnabled"
  | "setEqualizerBands"
  | "setPreampGain"
  | "setSpeed"
  | "setPitch"
  | "setPitchSync"
  | "syncPlayMode"
  | "syncLikeState"
  | "dispatch"
  | "onEvent"
> {
  browseFs(path?: string): Promise<IpcResponse<any>>;
}

export interface IAppClient {
  readonly mode: ClientMode;
  readonly player: IPlayerClient;
  readonly isElectron: boolean;
}
