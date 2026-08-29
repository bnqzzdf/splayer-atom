import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hostProcessSource = readFileSync(
  new URL("../plugins/host-process.ts", import.meta.url),
  "utf8",
);
const pluginNetSource = readFileSync(new URL("../plugins/net.ts", import.meta.url), "utf8");
const registrySource = readFileSync(new URL("../plugins/registry.ts", import.meta.url), "utf8");
const coreEntrySource = readFileSync(new URL("../core-node/index.ts", import.meta.url), "utf8");
const nodeHostSource = readFileSync(new URL("../atom/pluginHostNode.ts", import.meta.url), "utf8");
const viteSource = readFileSync(
  new URL("../../../scripts/atom/vite.core.config.ts", import.meta.url),
  "utf8",
);

test("plugin registry and host routing stay Electron-free inside the Core graph", () => {
  for (const source of [hostProcessSource, pluginNetSource, registrySource]) {
    assert.doesNotMatch(source, /from ["']electron["']/);
  }
  assert.match(hostProcessSource, /spawnRuntimePluginHost\(\)/);
  assert.match(pluginNetSource, /runtimeFetch/);
  assert.match(registrySource, /runtimeEnvironment\.appVersion/);
});

test("Node Core initializes and shuts down the same plugin registry", () => {
  assert.match(coreEntrySource, /pluginRegistry\.init\(\)/);
  assert.match(coreEntrySource, /await pluginRegistry\.shutdown\(\)/);
  assert.match(coreEntrySource, /ATOM_PLUGIN_HOST_ENTRY/);
});

test("Core build emits a Node IPC wrapper for the existing plugin sandbox worker", () => {
  assert.match(
    viteSource,
    /"plugin-host": resolve\(root, "electron\/main\/atom\/pluginHostNode\.ts"\)/,
  );
  assert.match(nodeHostSource, /process\.send/);
  assert.match(nodeHostSource, /await import\("@main\/plugins\/host\.worker"\)/);
});
