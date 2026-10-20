import { fork } from "node:child_process";
import path from "node:path";

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
 * 插件 host 的 Node 权限模型参数
 * 插件脚本可经宿主对象逃出 vm 拿到 process，这里禁止子进程、原生模块与写文件，只允许读取 Core 构建目录
 * @param entry - plugin-host 入口路径
 */
export const pluginHostExecArgv = (entry: string): string[] => [
  "--permission",
  `--allow-fs-read=${path.dirname(path.resolve(entry))}`,
];

const spawnNodePluginHost: RuntimePluginHostSpawner = (entry) => {
  const child = fork(entry, [], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    serialization: "advanced",
    execArgv: pluginHostExecArgv(entry),
  });
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    onMessage: (listener) => child.on("message", listener),
    onExit: (listener) => child.on("exit", listener),
    postMessage: (message) => {
      if (!child.connected) throw new Error("plugin host process is not connected");
      child.send(message as any);
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
