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

export const spawnRuntimePluginHost = (): RuntimePluginHostChild => {
  const entry = process.env.ATOM_PLUGIN_HOST_ENTRY?.trim();
  if (!entry) throw new Error("ATOM_PLUGIN_HOST_ENTRY is not configured");
  return spawnNodePluginHost(entry);
};
