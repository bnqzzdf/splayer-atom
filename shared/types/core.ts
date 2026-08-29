/** Atom Core 与 Control 之间的最小兼容契约。 */

export interface CoreProtocolInfo {
  version: number;
}

export interface CoreCapabilities {
  library: boolean;
  playback: boolean;
  download: boolean;
  diretta: boolean;
  netease: boolean;
  qobuz: boolean;
  tidal: boolean;
  remoteOutput: boolean;
}

export interface CoreInfo {
  name: string;
  version: string;
  platform: string;
  arch: string;
  node: string;
  nodeRange: string;
  nodeReference: string;
  protocol: CoreProtocolInfo;
  capabilities: CoreCapabilities;
}
