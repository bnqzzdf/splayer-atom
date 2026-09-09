import { loadNativeModule } from "@main/utils/nativeLoader";

export type ManagedStreamingPlatform = "qobuz" | "tidal";

type StreamingNativeModule = {
  callStreamingProvider: (
    platform: ManagedStreamingPlatform,
    action: string,
    auth: Record<string, unknown>,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
};

let nativeModule: StreamingNativeModule | null | undefined;

const getNativeModule = (): StreamingNativeModule => {
  if (nativeModule === undefined) {
    nativeModule = loadNativeModule<StreamingNativeModule>("streaming-api.node", "streaming-api");
  }
  if (!nativeModule) {
    throw new Error("Failed to load streaming-api.node");
  }
  return nativeModule;
};

/**
 * 调用 Qobuz/TIDAL 唯一 Rust 协议实现。
 * Node Core 仍持有 session、凭据和播放策略；这里不提供 JS fallback。
 */
export const callStreamingNative = async (
  platform: ManagedStreamingPlatform,
  action: string,
  auth: Record<string, unknown> = {},
  params: Record<string, unknown> = {},
): Promise<unknown> => getNativeModule().callStreamingProvider(platform, action, auth, params);
