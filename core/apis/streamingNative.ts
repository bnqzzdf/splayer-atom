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

const REFRESHED_AUTH_ERROR_PREFIX = "SPLAYER_REFRESHED_AUTH_ERROR:";

const decorateNativeError = (error: unknown): Error => {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.startsWith(REFRESHED_AUTH_ERROR_PREFIX)) {
    return error instanceof Error ? error : new Error(message);
  }
  try {
    const payload = JSON.parse(message.slice(REFRESHED_AUTH_ERROR_PREFIX.length)) as {
      message?: string;
      status?: number;
      refreshedAuth?: unknown;
    };
    const decorated = new Error(payload.message ?? "Streaming request failed");
    Object.assign(decorated, {
      status: payload.status,
      refreshedAuth: payload.refreshedAuth,
    });
    return decorated;
  } catch {
    return new Error(message);
  }
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
): Promise<unknown> => {
  try {
    return await getNativeModule().callStreamingProvider(platform, action, auth, params);
  } catch (error) {
    throw decorateNativeError(error);
  }
};
