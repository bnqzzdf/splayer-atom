import { fork } from "node:child_process";
import path from "node:path";
import { decodePluginIpc, encodePluginIpc } from "./pluginIpc";

export interface RuntimePluginHostStream {
  on: (event: "data", listener: (chunk: Buffer) => void) => unknown;
}

export interface RuntimePluginHostChild {
  stdout: RuntimePluginHostStream | null;
  stderr: RuntimePluginHostStream | null;
  onMessage: (listener: (message: unknown) => void) => void;
  onExit: (listener: (code: number | null) => void) => void;
  postMessage: (message: unknown) => void;
  kill: () => void;
}

export type RuntimePluginHostSpawner = (entry: string) => RuntimePluginHostChild;

/**
 * Node 插件 Host 保留原有权限配置以减少意外访问，但不将其视为恶意插件安全沙箱。
 * @param entry - plugin-host 入口路径
 */
export const pluginHostExecArgv = (entry: string): string[] => [
  "--permission",
  `--allow-fs-read=${path.dirname(path.resolve(entry))}`,
];

const spawnNodePluginHost: RuntimePluginHostSpawner = (entry) => {
  const bunParent = Boolean(process.versions.bun);
  // Bun 未实现等价的权限开关，实验版只执行用户信任的插件，不承诺安全隔离恶意代码。
  const child = fork(entry, [], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    serialization: bunParent ? "json" : "advanced",
    execArgv: bunParent ? [] : pluginHostExecArgv(entry),
    ...(bunParent
      ? { execPath: process.execPath, env: { ...process.env, ATOM_PLUGIN_IPC_JSON: "1" } }
      : {}),
  });
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    onMessage: (listener) =>
      child.on("message", (message) => listener(bunParent ? decodePluginIpc(message) : message)),
    onExit: (listener) => child.on("exit", listener),
    postMessage: (message) => {
      if (!child.connected) throw new Error("plugin host process is not connected");
      child.send((bunParent ? encodePluginIpc(message) : message) as any);
    },
    kill: () => {
      child.kill();
    },
  };
};

export const spawnRuntimePluginHost = (): RuntimePluginHostChild => {
  const entry = process.env.ATOM_PLUGIN_HOST_ENTRY?.trim();
  if (!entry) throw new Error("ATOM_PLUGIN_HOST_ENTRY is not configured");
  return spawnNodePluginHost(entry);
};
