import fs from "node:fs";
import path from "node:path";
import { writeFileSync as atomicWriteSync } from "atomically";
import { configDir } from "@main/utils/paths";
import { coreLog } from "@main/utils/logger";
import { runtimeSecretCodec } from "@main/atom/runtime/secrets";

const STORAGE_FILE = path.join(configDir, "tidal.json");

export interface TidalAuthState {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  userId?: string;
  username?: string;
  countryCode?: string;
  clientId?: string;
  clientSecret?: string;
}

interface PersistedTidalAuth {
  encryptedAccessToken: string;
  encryptedRefreshToken?: string;
  encryptedClientSecret?: string;
  expiresAt?: number;
  userId?: string;
  username?: string;
  countryCode?: string;
  clientId?: string;
}

let authState: TidalAuthState | null | undefined;

const encrypt = (plain: string): string => {
  if (!plain) return "";
  if (!runtimeSecretCodec.protectedAtRest) {
    coreLog.warn("[tidal] 当前 Core secret codec 不提供静态加密，仅写入 0600 credential file");
  }
  return runtimeSecretCodec.encode(plain);
};

const decrypt = (encrypted: string | undefined): string => {
  if (!encrypted) return "";
  try {
    return runtimeSecretCodec.decode(encrypted);
  } catch {
    return "";
  }
};

const numberFromEnv = (value: string | undefined): number | undefined => {
  if (!value?.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const load = (): TidalAuthState | null => {
  const accessToken = process.env.TIDAL_ACCESS_TOKEN?.trim() ?? "";
  if (accessToken) {
    return {
      accessToken,
      refreshToken: process.env.TIDAL_REFRESH_TOKEN?.trim() || undefined,
      expiresAt: numberFromEnv(process.env.TIDAL_EXPIRES_AT),
      userId: process.env.TIDAL_USER_ID?.trim() || undefined,
      username: process.env.TIDAL_USERNAME?.trim() || undefined,
      countryCode: process.env.TIDAL_COUNTRY_CODE?.trim() || undefined,
      clientId: process.env.TIDAL_CLIENT_ID?.trim() || undefined,
      clientSecret: process.env.TIDAL_CLIENT_SECRET?.trim() || undefined,
    };
  }

  try {
    const persisted = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8")) as PersistedTidalAuth;
    const persistedAccessToken = decrypt(persisted.encryptedAccessToken);
    if (!persistedAccessToken) return null;
    return {
      accessToken: persistedAccessToken,
      refreshToken: decrypt(persisted.encryptedRefreshToken) || undefined,
      expiresAt: persisted.expiresAt,
      userId: persisted.userId,
      username: persisted.username,
      countryCode: persisted.countryCode,
      clientId: persisted.clientId,
      clientSecret: decrypt(persisted.encryptedClientSecret) || undefined,
    };
  } catch {
    return null;
  }
};

export const getTidalAuth = (): TidalAuthState | null => {
  if (authState === undefined) authState = load();
  return authState;
};

export const setTidalAuth = (state: TidalAuthState): void => {
  authState = state;
  try {
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    const persisted: PersistedTidalAuth = {
      encryptedAccessToken: encrypt(state.accessToken),
      encryptedRefreshToken: state.refreshToken ? encrypt(state.refreshToken) : undefined,
      encryptedClientSecret: state.clientSecret ? encrypt(state.clientSecret) : undefined,
      expiresAt: state.expiresAt,
      userId: state.userId,
      username: state.username,
      countryCode: state.countryCode,
      clientId: state.clientId,
    };
    atomicWriteSync(STORAGE_FILE, JSON.stringify(persisted, null, 2));
    fs.chmodSync(STORAGE_FILE, 0o600);
  } catch (err) {
    coreLog.error("[tidal] 保存登录态失败:", err);
  }
};

export const clearTidalAuth = (): void => {
  authState = null;
  try {
    if (fs.existsSync(STORAGE_FILE)) fs.rmSync(STORAGE_FILE);
  } catch (err) {
    coreLog.error("[tidal] 清除登录态失败:", err);
  }
};

export const getTidalAuthStatus = (): {
  loggedIn: boolean;
  userId?: string;
  username?: string;
  countryCode?: string;
  expiresAt?: number;
  refreshable?: boolean;
} => {
  const auth = getTidalAuth();
  if (!auth) return { loggedIn: false };
  return {
    loggedIn: true,
    userId: auth.userId,
    username: auth.username,
    countryCode: auth.countryCode,
    expiresAt: auth.expiresAt,
    refreshable: Boolean(auth.refreshToken && auth.clientId),
  };
};
