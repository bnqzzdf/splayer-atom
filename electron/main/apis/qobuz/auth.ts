import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";
import { configDir } from "@main/utils/paths";
import { coreLog } from "@main/utils/logger";

const STORAGE_FILE = path.join(configDir, "qobuz.json");

export interface QobuzAuthState {
  userId?: string;
  username?: string;
  token: string;
}

interface PersistedQobuzAuth {
  userId?: string;
  username?: string;
  encryptedToken: string;
}

let authState: QobuzAuthState | null | undefined;

const encrypt = (plain: string): string => {
  if (!plain) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    coreLog.warn("[qobuz] safeStorage 不可用，用户 token 将以 base64 形式落盘");
    return Buffer.from(plain, "utf-8").toString("base64");
  }
  return safeStorage.encryptString(plain).toString("base64");
};

const decrypt = (encrypted: string): string => {
  if (!encrypted) return "";
  try {
    const buffer = Buffer.from(encrypted, "base64");
    if (!safeStorage.isEncryptionAvailable()) return buffer.toString("utf-8");
    return safeStorage.decryptString(buffer);
  } catch {
    return "";
  }
};

const load = (): QobuzAuthState | null => {
  const envToken = process.env.QOBUZ_USER_AUTH_TOKEN?.trim() ?? "";
  if (envToken) {
    const userId = process.env.QOBUZ_USER_ID?.trim() || undefined;
    return {
      userId,
      username: process.env.QOBUZ_USERNAME?.trim() || userId,
      token: envToken,
    };
  }

  try {
    const persisted = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8")) as PersistedQobuzAuth;
    const token = decrypt(persisted.encryptedToken);
    if (!token) return null;
    return {
      userId: persisted.userId,
      username: persisted.username || persisted.userId,
      token,
    };
  } catch {
    return null;
  }
};

/**
 * 获取当前 Qobuz 登录态，首次读取时从环境变量或安全持久化文件恢复。
 * @returns 当前登录态，未登录时返回 null
 */
export const getQobuzAuth = (): QobuzAuthState | null => {
  if (authState === undefined) authState = load();
  return authState;
};

/**
 * 保存 Qobuz 登录态。
 * @param state - 已验证的用户身份与 token
 */
export const setQobuzAuth = (state: QobuzAuthState): void => {
  authState = state;
  try {
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    const persisted: PersistedQobuzAuth = {
      userId: state.userId,
      username: state.username,
      encryptedToken: encrypt(state.token),
    };
    atomicWriteSync(STORAGE_FILE, JSON.stringify(persisted, null, 2));
  } catch (err) {
    coreLog.error("[qobuz] 保存登录态失败:", err);
  }
};

/** 清除 Qobuz 登录态。 */
export const clearQobuzAuth = (): void => {
  authState = null;
  try {
    if (fs.existsSync(STORAGE_FILE)) fs.rmSync(STORAGE_FILE);
  } catch (err) {
    coreLog.error("[qobuz] 清除登录态失败:", err);
  }
};

/**
 * 返回不包含 token 的登录状态。
 * @returns 可安全暴露给渲染进程的状态
 */
export const getQobuzAuthStatus = (): { loggedIn: boolean; userId?: string; username?: string } => {
  const auth = getQobuzAuth();
  if (!auth) return { loggedIn: false };
  return { loggedIn: true, userId: auth.userId, username: auth.username };
};
