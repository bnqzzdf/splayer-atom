import { fork } from "node:child_process";

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

let configuredEntry = process.env.ATOM_PLUGIN_HOST_ENTRY?.trim() ?? "";
let configuredSpawner: RuntimePluginHostSpawner | null = null;

const spawnNodePluginHost: RuntimePluginHostSpawner = (entry) => {
  const child = fork(entry, [], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    serialization: "advanced",
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

/** Desktop entry 可注入 Electron utilityProcess；Node Core 默认使用 child_process.fork。 */
export const configureRuntimePluginHost = (options: {
  entry: string;
  spawn?: RuntimePluginHostSpawner;
}): void => {
  configuredEntry = options.entry;
  configuredSpawner = options.spawn ?? null;
};

export const spawnRuntimePluginHost = (): RuntimePluginHostChild => {
  const entry = configuredEntry || process.env.ATOM_PLUGIN_HOST_ENTRY?.trim();
  if (!entry) throw new Error("ATOM_PLUGIN_HOST_ENTRY is not configured");
  return (configuredSpawner ?? spawnNodePluginHost)(entry);
};
