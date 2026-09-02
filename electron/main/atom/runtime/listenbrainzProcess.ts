import { fork } from "node:child_process";

export interface ListenBrainzProcess {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  onMessage(listener: (message: unknown) => void): void;
  onExit(listener: (code: number | null) => void): void;
  send(message: unknown): void;
  kill(): void;
}

export type ListenBrainzProcessSpawner = (entry: string) => ListenBrainzProcess;

let configuredEntry = process.env.ATOM_LISTENBRAINZ_CHILD_ENTRY?.trim() ?? "";
let configuredSpawner: ListenBrainzProcessSpawner | null = null;

const spawnNodeChild: ListenBrainzProcessSpawner = (entry) => {
  const child = fork(entry, [], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    serialization: "advanced",
  });
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    onMessage: (listener) => child.on("message", listener),
    onExit: (listener) => child.on("exit", listener),
    send: (message) => {
      if (!child.connected) throw new Error("ListenBrainz child process is not connected");
      child.send(message as any);
    },
    kill: () => child.kill(),
  };
};

/** Desktop 注入 utilityProcess；普通 Node Core 使用 child_process.fork。 */
export const configureListenBrainzProcess = (options: {
  entry: string;
  spawn?: ListenBrainzProcessSpawner;
}): void => {
  configuredEntry = options.entry;
  configuredSpawner = options.spawn ?? null;
};

export const spawnListenBrainzProcess = (): ListenBrainzProcess => {
  const entry = configuredEntry || process.env.ATOM_LISTENBRAINZ_CHILD_ENTRY?.trim();
  if (!entry) throw new Error("ATOM_LISTENBRAINZ_CHILD_ENTRY is not configured");
  return (configuredSpawner ?? spawnNodeChild)(entry);
};
