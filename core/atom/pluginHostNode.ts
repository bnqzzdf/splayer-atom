import type { SandboxIn, SandboxOut } from "@shared/types/plugin";
import { decodePluginIpc, encodePluginIpc } from "./runtime/pluginIpc";

if (typeof process.send !== "function") {
  throw new Error("Atom plugin host must be started with an IPC channel");
}

(process as any).parentPort = {
  on: (_event: "message", listener: (event: { data: SandboxIn }) => void) => {
    process.on("message", (message) =>
      listener({
        data: (process.env.ATOM_PLUGIN_IPC_JSON === "1"
          ? decodePluginIpc(message)
          : message) as SandboxIn,
      }),
    );
  },
  postMessage: (message: SandboxOut) => {
    process.send?.(
      (process.env.ATOM_PLUGIN_IPC_JSON === "1" ? encodePluginIpc(message) : message) as any,
    );
  },
};

await import("@main/plugins/host.worker");
