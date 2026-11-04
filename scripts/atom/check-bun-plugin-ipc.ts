import assert from "node:assert/strict";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnRuntimePluginHost } from "../../core/atom/runtime/pluginHost";

if (!process.versions.bun) throw new Error("This plugin IPC check must run under Bun");
const root = fileURLToPath(new URL("../..", import.meta.url));
process.env.ATOM_PLUGIN_HOST_ENTRY ??= path.join(root, "out/core/plugin-host.js");

const networkProbe = createServer((_request, response) => response.end("HOST_NETWORK_EXPOSED"));
await new Promise<void>((resolve) => networkProbe.listen(0, "127.0.0.1", resolve));
const address = networkProbe.address();
if (!address || typeof address === "string") throw new Error("Network probe not listening");

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
      const message = value as {
        kind: string;
        data?: {
          bytes: Uint8Array;
          runtime: string;
          readHost: boolean;
          spawnChild: boolean;
          spawnError: string;
          hostNetwork: boolean;
          envLeak: boolean;
          storageBytes: Uint8Array;
        };
        callId?: string;
        method?: string;
        error?: unknown;
      };
      if (message.kind === "hostReady") {
        child.postMessage({
          kind: "loadPlugin",
          pluginId: "bun-ipc-smoke",
          apiLevel: 1,
          locale: "zh",
          appVersion: "1",
          userSettings: {},
          source: `
            splayer.on("musicSearch", async (req) => {
              const host = splayer.utils.crypto.md5.constructor("return globalThis")();
              let readHost = false;
              let spawnChild = false;
              let spawnError = "";
              let hostNetwork = false;
              const storageBytes = await splayer.storage.get("binary-probe");
              try { await host.Bun.file("/etc/hostname").text(); readHost = true; } catch {}
              try {
                const child = host.Bun.spawn(["/runtime/bun", "--version"]);
                spawnChild = (await child.exited) === 0;
              } catch (error) { spawnError = String(error); }
              try {
                const response = await host.fetch("http://127.0.0.1:${address.port}/", {
                  signal: host.AbortSignal.timeout(400)
                });
                hostNetwork = (await response.text()) === "HOST_NETWORK_EXPOSED";
              } catch {}
              return {
                bytes: req.bytes,
                runtime: host.process.versions.bun ?? "not-bun",
                readHost,
                spawnChild,
                spawnError,
                hostNetwork,
                envLeak: Boolean(host.process.env.ATOM_SANDBOX_PROBE_SECRET),
                storageBytes,
              };
            });
          `,
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
      } else if (message.kind === "hostCall") {
        if (message.method !== "storage.get") throw new Error(`Unexpected host call: ${message.method}`);
        child.postMessage({
          kind: "hostResult",
          pluginId: "bun-ipc-smoke",
          callId: message.callId,
          ok: true,
          data: new Uint8Array([7, 8, 9]),
        });
      } else if (message.kind === "result") {
        clearTimeout(timeout);
        try {
          assert.deepEqual(message.data?.bytes, new Uint8Array([0, 127, 255]));
          assert.equal(message.data?.runtime, process.versions.bun);
          assert.equal(message.data?.readHost, false, "plugin must not read host /etc/hostname");
          assert.equal(message.data?.spawnChild, false, "plugin must not spawn child processes");
          assert.match(message.data?.spawnError ?? "", /not permitted|EPERM|ENOSYS|permission denied/i);
          assert.equal(message.data?.hostNetwork, false, "plugin must not access host loopback network");
          assert.equal(message.data?.envLeak, false, "plugin must not inherit host environment");
          assert.deepEqual(message.data?.storageBytes, new Uint8Array([7, 8, 9]));
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
  console.log("[BunPluginIPC] PASS Bun main <-> sandboxed Bun plugin host: binary IPC, filesystem, process, network, environment restrictions");
} finally {
  child.kill();
  await new Promise<void>((resolve, reject) => networkProbe.close((error) => (error ? reject(error) : resolve())));
}
