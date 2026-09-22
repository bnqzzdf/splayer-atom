type LogMethod = (...args: unknown[]) => void;

export interface ScopedLogger {
  log: LogMethod;
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
}

const emit =
  (method: "log" | "debug" | "info" | "warn" | "error", scope: string): LogMethod =>
  (...args) =>
    console[method](`[${scope}]`, ...args);

const scope = (name: string): ScopedLogger => ({
  log: emit("log", name),
  debug: emit("debug", name),
  info: emit("info", name),
  warn: emit("warn", name),
  error: emit("error", name),
});

/** Core 日志直接写 stdout/stderr，由 systemd/journald 负责持久化。 */
export const initLogger = (): void => {
  coreLog.info("日志系统已初始化 (stdout/stderr)");
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
