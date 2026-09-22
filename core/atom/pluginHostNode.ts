import type { SandboxIn, SandboxOut } from "@shared/types/plugin";

if (typeof process.send !== "function") {
  throw new Error("Atom plugin host must be started with an IPC channel");
}

(process as any).parentPort = {
  on: (_event: "message", listener: (event: { data: SandboxIn }) => void) => {
    process.on("message", (message) => listener({ data: message as SandboxIn }));
  },
  postMessage: (message: SandboxOut) => {
    process.send?.(message);
  },
};

await import("@main/plugins/host.worker");
