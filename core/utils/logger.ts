import os from "node:os";
import type {
  CoreDiagnosticLogEntry,
  CoreLogLevel,
  CoreLogLevelSnapshot,
} from "@shared/types/core";

type LogMethod = (...args: unknown[]) => void;

export interface ScopedLogger {
  log: LogMethod;
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
}

const DEFAULT_LOG_LEVEL: CoreLogLevel = "info";
const MAX_RECENT_LOGS = 500;
const MAX_LOG_MESSAGE_CHARS = 2000;
const REDACTED = "[REDACTED]";

const LEVEL_WEIGHT: Record<CoreLogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const SENSITIVE_KEY_PATTERN =
  /^(?:authorization|cookie|cookies|set-cookie|token|access[_-]?token|refresh[_-]?token|id[_-]?token|password|passwd|pwd|secret|client[_-]?secret|api[_-]?key|apikey|credential|credentials|music_u|musickey|qm_keyst|qqmusic_key|p_skey|pskey|skey|vkey|ptsigx|sig|sign|signature|auth|uin|userid)$/i;

const SENSITIVE_QUERY_PARAM_PATTERN =
  /([?&](?:token|access_token|refresh_token|auth|key|apikey|api_key|sig|sign|signature|cookie|password|pwd|secret|client_secret|vkey|guid|uin|ptsigx|skey|p_skey|pskey|music_u|musickey|qm_keyst|qqmusic_key|code)=)([^&#\s"']+)/gi;

const URL_USERINFO_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+:[^/\s@]+@)/gi;
const AUTH_SCHEME_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{4,}/gi;
const HEADER_SECRET_PATTERN = /(\b(?:Authorization|Cookie|Set-Cookie)\s*:\s*)([^\r\n;]+)/gi;
const KV_SECRET_PATTERN =
  /(\b(?:MUSIC_U|qm_keyst|qqmusic_key|p_skey|pskey|skey|musickey|vkey|access_token|refresh_token|client_secret|api_key|apikey|password|passwd|secret|token)\s*[:=]\s*["']?)([^"'\s,;}\]]+)/gi;

let runtimeOverrideLevel: CoreLogLevel | null = null;
const recentBuffer: Array<CoreDiagnosticLogEntry | undefined> = new Array(MAX_RECENT_LOGS);
let recentWriteIndex = 0;
let recentCount = 0;

export const parseLogLevel = (value: string | null | undefined): CoreLogLevel | null => {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "error" ||
    normalized === "warn" ||
    normalized === "info" ||
    normalized === "debug"
  ) {
    return normalized;
  }
  return null;
};

export const getDefaultLogLevel = (): CoreLogLevel =>
  parseLogLevel(process.env.ATOM_LOG_LEVEL) ?? DEFAULT_LOG_LEVEL;

export const getLogLevel = (): CoreLogLevel => runtimeOverrideLevel ?? getDefaultLogLevel();

export const getLogLevelSnapshot = (): CoreLogLevelSnapshot => ({
  level: getLogLevel(),
  defaultLevel: getDefaultLogLevel(),
  overridden: runtimeOverrideLevel !== null,
});

export const setLogLevel = (level: CoreLogLevel): CoreLogLevelSnapshot => {
  runtimeOverrideLevel = level;
  return getLogLevelSnapshot();
};

export const resetLogLevel = (): CoreLogLevelSnapshot => {
  runtimeOverrideLevel = null;
  return getLogLevelSnapshot();
};

const redactHomeDir = (text: string): string => {
  const home = os.homedir();
  if (!home || home === "/") return text;
  const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`${escaped}(?=$|[\\\\/\\s"',;\\]})])`, "g"), "~");
};

export const redactDiagnosticText = (text: string): string =>
  redactHomeDir(text)
    .replace(URL_USERINFO_PATTERN, `$1${REDACTED}@`)
    .replace(SENSITIVE_QUERY_PARAM_PATTERN, `$1${REDACTED}`)
    .replace(AUTH_SCHEME_PATTERN, `$1 ${REDACTED}`)
    .replace(HEADER_SECRET_PATTERN, `$1${REDACTED}`)
    .replace(KV_SECRET_PATTERN, `$1${REDACTED}`);

const sanitizeForLog = (value: unknown, seen = new WeakSet<object>(), depth = 0): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactDiagnosticText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactDiagnosticText(value.message),
    };
  }
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  if (depth >= 4) return "[Object]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeForLog(item, seen, depth + 1));
  }
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? REDACTED
      : sanitizeForLog(entry, seen, depth + 1);
  }
  return output;
};

const formatArg = (arg: unknown): string => {
  if (typeof arg === "string") return redactDiagnosticText(arg);
  if (arg instanceof Error) return redactDiagnosticText(`${arg.name}: ${arg.message}`);
  if (arg === null || arg === undefined || typeof arg !== "object") return String(arg);
  try {
    return redactDiagnosticText(JSON.stringify(sanitizeForLog(arg)));
  } catch {
    return "[Unserializable]";
  }
};

const pushRecentLog = (level: CoreLogLevel, scope: string, args: unknown[]): void => {
  const joined = args.map(formatArg).join(" ");
  const message =
    joined.length > MAX_LOG_MESSAGE_CHARS
      ? `${joined.slice(0, MAX_LOG_MESSAGE_CHARS)}...(truncated)`
      : joined;
  recentBuffer[recentWriteIndex] = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
  };
  recentWriteIndex = (recentWriteIndex + 1) % MAX_RECENT_LOGS;
  if (recentCount < MAX_RECENT_LOGS) recentCount += 1;
};

export const getRecentLogs = (): CoreDiagnosticLogEntry[] => {
  if (recentCount === 0) return [];
  const start = recentCount === MAX_RECENT_LOGS ? recentWriteIndex : 0;
  const entries: CoreDiagnosticLogEntry[] = [];
  for (let i = 0; i < recentCount; i += 1) {
    const entry = recentBuffer[(start + i) % MAX_RECENT_LOGS];
    if (entry) entries.push(entry);
  }
  return entries;
};

export const clearRecentLogs = (): void => {
  recentBuffer.fill(undefined);
  recentWriteIndex = 0;
  recentCount = 0;
};

const emit =
  (method: "log" | "debug" | "info" | "warn" | "error", scope: string): LogMethod =>
  (...args) => {
    const level: CoreLogLevel = method === "log" ? "info" : method;
    if (LEVEL_WEIGHT[level] > LEVEL_WEIGHT[getLogLevel()]) return;
    console[method](`[${scope}]`, ...args);
    pushRecentLog(level, scope, args);
  };

const scope = (name: string): ScopedLogger => ({
  log: emit("log", name),
  debug: emit("debug", name),
  info: emit("info", name),
  warn: emit("warn", name),
  error: emit("error", name),
});

/** Core 日志直接写 stdout/stderr，由 systemd/journald 负责持久化；内存环形缓冲仅用于诊断导出。 */
export const initLogger = (): void => {
  coreLog.info(`日志系统已初始化 (stdout/stderr, level=${getLogLevel()})`);
};

export const coreLog = scope("core");
export const playerLog = scope("player");
export const systemLog = scope("system");
export const libraryLog = scope("library");
export const nativeLog = scope("native");
export const streamingLog = scope("streaming");
export const songCacheLog = scope("songCache");
export const downloadLog = scope("download");
export const serverLog = scope("server");
export const pluginLog = scope("plugin");
export const neteaseLog = scope("netease");
