import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnRuntimePluginHost } from "../../core/atom/runtime/pluginHost";

if (!process.versions.bun) throw new Error("This plugin IPC check must run under Bun");
const root = fileURLToPath(new URL("../..", import.meta.url));
process.env.ATOM_PLUGIN_HOST_ENTRY = path.join(root, "out/core/plugin-host.js");

const child = spawnRuntimePluginHost();
let diagnostic = "";
child.stdout?.on("data", (data) => (diagnostic += data.toString()));
child.stderr?.on("data", (data) => (diagnostic += data.toString()));

try {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Plugin IPC timed out: ${diagnostic}`)), 6000);
    child.onExit((code) => {
      clearTimeout(timeout);
      reject(new Error(`Plugin Host exited ${code}: ${diagnostic}`));
    });
    child.onMessage((value) => {
      const message = value as { kind: string; data?: { bytes: Uint8Array }; error?: unknown };
      if (message.kind === "hostReady") {
        child.postMessage({
          kind: "loadPlugin",
          pluginId: "bun-ipc-smoke",
          apiLevel: 1,
          locale: "zh",
          appVersion: "1",
          userSettings: {},
          source: 'splayer.on("musicSearch", async (req) => ({ bytes: req.bytes }));',
          scriptInfo: { name: "smoke", description: "", version: "1", author: "", homepage: "" },
        });
      } else if (message.kind === "ready") {
        child.postMessage({
          kind: "call",
          pluginId: "bun-ipc-smoke",
          requestId: "binary-echo",
          action: "musicSearch",
          params: { bytes: new Uint8Array([0, 127, 255]) },
        });
      } else if (message.kind === "result") {
        clearTimeout(timeout);
        try {
          assert.deepEqual(message.data?.bytes, new Uint8Array([0, 127, 255]));
          resolve();
        } catch (error) {
          reject(error);
        }
      } else if (message.kind === "fatal") {
        clearTimeout(timeout);
        reject(new Error(`Plugin Host fatal ${JSON.stringify(message.error)}`));
      }
    });
  });
  console.log("[BunPluginIPC] PASS Bun main <-> restricted Node plugin host: Uint8Array echo");
} finally {
  child.kill();
}
