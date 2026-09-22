/** Atom Core 与 Control 之间的最小兼容契约。 */

import type { ManagedProviderPlatform } from "./apis";

export interface CoreProtocolInfo {
  version: number;
}

/**
 * Core 域能力开关。
 *
 * 托管在线平台的能力位不再逐个手写，而是由 `MANAGED_PROVIDER_PLATFORMS` 机械展开，
 * 这样「Core 真正支持的平台集合」与「发布产物声明的能力位」只有唯一来源，不会再漂移。
 */
export interface CoreCapabilities extends Record<ManagedProviderPlatform, boolean> {
  library: boolean;
  playback: boolean;
  download: boolean;
  diretta: boolean;
  remoteOutput: boolean;
}

export interface CoreInfo {
  name: string;
  version: string;
  commit: string;
  sourceDirty: boolean;
  platform: string;
  arch: string;
  node: string;
  nodeRange: string;
  nodeReference: string;
  direttaSdkRelease?: number | null;
  protocol: CoreProtocolInfo;
  capabilities: CoreCapabilities;
}
