import {
  clearTidalAuth,
  getTidalAuth,
  getTidalAuthStatus,
  setTidalAuth,
  type TidalAuthState,
} from "./auth";
import { callStreamingNative } from "@main/apis/streamingNative";
import { runtimeEnvironment } from "@main/atom/runtime/environment";

export type TidalParams = Record<string, unknown>;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const stringValue = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
};

const numberValue = (value: unknown): number | undefined => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const expiresAtMs = (value: unknown, expiresIn: unknown): number | undefined => {
  const explicit = numberValue(value);
  if (explicit !== undefined && explicit > 0) {
    return explicit < 10_000_000_000 ? explicit * 1000 : explicit;
  }
  const seconds = numberValue(expiresIn);
  return seconds !== undefined && seconds > 0 ? Date.now() + seconds * 1000 : undefined;
};

const nativeAuth = (): Record<string, unknown> => {
  const auth = getTidalAuth();
  if (!auth) return {};
  return {
    access_token: auth.accessToken,
    refresh_token: auth.refreshToken,
    user_id: auth.userId,
    country_code: auth.countryCode,
    client_id: auth.clientId,
    client_secret: auth.clientSecret,
  };
};

const persistAuthResponse = (
  responseValue: unknown,
  params: TidalParams,
): Record<string, unknown> => {
  const response = asRecord(responseValue);
  const current = getTidalAuth();
  const accessToken = stringValue(response.accessToken) ?? current?.accessToken;
  if (!accessToken) return response;

  const next: TidalAuthState = {
    accessToken,
    refreshToken: stringValue(response.refreshToken) ?? current?.refreshToken,
    expiresAt: expiresAtMs(response.expiresAt, response.expiresIn) ?? current?.expiresAt,
    userId: stringValue(response.userId) ?? current?.userId,
    username: stringValue(response.username) ?? current?.username,
    countryCode: stringValue(response.countryCode) ?? current?.countryCode,
    clientId:
      stringValue(response.clientId) ??
      stringValue(params.clientId) ??
      stringValue(params.client_id) ??
      current?.clientId,
    clientSecret:
      stringValue(params.clientSecret) ??
      stringValue(params.client_secret) ??
      current?.clientSecret,
  };
  setTidalAuth(next);
  return response;
};

const unwrapRefreshedResponse = (value: unknown): unknown => {
  const envelope = asRecord(value);
  const refreshed = asRecord(envelope.refreshedAuth);
  const accessToken = stringValue(refreshed.accessToken);
  if (!accessToken) return value;

  const current = getTidalAuth();
  if (!current) return value;
  setTidalAuth({
    ...current,
    accessToken,
    refreshToken: stringValue(refreshed.refreshToken) ?? current.refreshToken,
    expiresAt: expiresAtMs(refreshed.expiresAt, refreshed.expiresIn) ?? current.expiresAt,
  });
  return envelope.result;
};

const authStatus = async (): Promise<unknown> => {
  const projection = getTidalAuthStatus();
  if (!getTidalAuth()) return projection;
  const remote = asRecord(await callStreamingNative("tidal", "auth_status", nativeAuth(), {}));
  return { ...projection, ...remote };
};

const authLogout = async (): Promise<unknown> => {
  try {
    return await callStreamingNative("tidal", "auth_logout", nativeAuth(), {});
  } finally {
    clearTidalAuth();
  }
};

/**
 * TIDAL Core 入口：Node Core 只持有 session，平台协议全部委托给 Rust streaming-api。
 */
export const callTidal = async (name: string, params: TidalParams = {}): Promise<unknown> => {
  if (name === "auth_status" || name === "status" || name === "user_detail") {
    return authStatus();
  }
  if (name === "auth_logout" || name === "logout") return authLogout();

  const nativeParams =
    name === "track_getStreamUrl" || name === "song_url"
      ? { ...params, _materialize_dir: runtimeEnvironment.tempDir }
      : params;
  const response = unwrapRefreshedResponse(
    await callStreamingNative("tidal", name, nativeAuth(), nativeParams),
  );
  if (
    name === "auth_exchange" ||
    name === "exchange" ||
    name === "auth_token_poll" ||
    name === "token_poll" ||
    name === "auth_token_refresh" ||
    name === "refresh_token"
  ) {
    return persistAuthResponse(response, params);
  }

  if (name === "track_getStreamUrl" || name === "song_url") {
    const record = asRecord(response);
    const data = asRecord(record.data);
    return {
      streamUrl: stringValue(data.url),
      localPath: stringValue(data.localPath),
      codec: stringValue(data.codec),
      audioQuality: stringValue(data.audioQuality),
      bitDepth: numberValue(data.bitDepth),
      sampleRate: numberValue(data.sampleRate),
      raw: record.raw,
    };
  }

  return response;
};
