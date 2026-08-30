import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serviceSource = readFileSync(new URL("./pluginControl.ts", import.meta.url), "utf8");
const routesSource = readFileSync(new URL("../atom/headless/routes.ts", import.meta.url), "utf8");
const coreEventsSource = readFileSync(
  new URL("../../../shared/types/coreEvents.ts", import.meta.url),
  "utf8",
);
const eventClientSource = readFileSync(
  new URL("../../../src/core/controlEventClient.ts", import.meta.url),
  "utf8",
);
const pluginClientSource = readFileSync(
  new URL("../../../src/core/pluginClient.ts", import.meta.url),
  "utf8",
);
const webApiSource = readFileSync(new URL("../../../src/web/api.ts", import.meta.url), "utf8");
const settingsSchemaSource = readFileSync(
  new URL("../../../src/settings/schema.ts", import.meta.url),
  "utf8",
);
const desktopCoreSource = readFileSync(new URL("../core/index.ts", import.meta.url), "utf8");
const nodeCoreSource = readFileSync(new URL("../core-node/index.ts", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../../preload/index.ts", import.meta.url), "utf8");
const playerControlSource = readFileSync(
  new URL("../../../src/core/player/index.ts", import.meta.url),
  "utf8",
);

test("Plugin Core service reuses the unique registry/router/metadata authority", () => {
  assert.doesNotMatch(serviceSource, /from ["']electron["']/);
  assert.match(serviceSource, /pluginRegistry\.listInfo\(\)/);
  assert.match(serviceSource, /pluginRegistry\.installFromSource\(source\)/);
  assert.match(serviceSource, /pluginRegistry\.uninstall\(id\)/);
  assert.match(serviceSource, /pluginRegistry\.setEnabled\(id, enabled\)/);
  assert.match(serviceSource, /pluginRegistry\.setSetting\(id, key, value\)/);
  assert.match(serviceSource, /pluginRegistry\.checkUpdate\(id\)/);
  assert.match(serviceSource, /pluginRegistry\.applyUpdateFromSource\(id, source\)/);
  assert.match(serviceSource, /resolveUrl\(args\)/);
  assert.match(serviceSource, /invokeMenu\(args\)/);
  assert.match(serviceSource, /matchLyric\(args\)/);
  assert.match(serviceSource, /matchCover\(args\)/);
  assert.match(serviceSource, /fetchMarket\(\)/);
});

test("Plugin Core routes and shared client use one path contract", () => {
  for (const path of [
    "/plugins",
    "/plugins/market",
    "/plugins/install-url",
    "/plugins/resolve-url",
    "/plugins/invoke-menu",
    "/plugins/match-lyric",
    "/plugins/match-cover",
  ]) {
    assert.match(routesSource, new RegExp(path.replaceAll("/", "\\/")));
    assert.match(pluginClientSource, new RegExp(path.replaceAll("/", "\\/")));
  }
  assert.match(routesSource, /\/plugins\/:id\/uninstall/);
  assert.match(routesSource, /\/plugins\/:id\/enabled/);
  assert.match(routesSource, /\/plugins\/:id\/setting/);
  assert.match(routesSource, /\/plugins\/:id\/check-update/);
  assert.match(routesSource, /\/plugins\/:id\/apply-update/);
  assert.match(pluginClientSource, /encodeURIComponent\(id\)/);
});

test("Plugin status uses the unified CoreControlEvent envelope in Desktop and Node Core", () => {
  assert.match(coreEventsSource, /type: "pluginStatus"; data: PluginInfo/);
  assert.match(serviceSource, /publishCoreControlEvent\(\{ type: "pluginStatus", data: info \}\)/);
  assert.match(eventClientSource, /event\.type === "pluginStatus"/);
  assert.match(pluginClientSource, /subscribeCoreControlEvent\("pluginStatus", callback\)/);
  for (const source of [desktopCoreSource, nodeCoreSource]) {
    assert.match(source, /registerPluginControlEvents\(\)/);
    assert.match(source, /unregisterPluginControlEvents\(\)/);
  }
});

test("Desktop legacy Plugin facade forwards business operations to the Core Protocol", () => {
  assert.match(preloadSource, /fetch\(`atom-core:\/\/control\/api\$\{path\}`/);
  for (const path of [
    "/plugins",
    "/plugins/market",
    "/plugins/install-url",
    "/plugins/resolve-url",
    "/plugins/invoke-menu",
    "/plugins/match-lyric",
    "/plugins/match-cover",
  ]) {
    assert.match(preloadSource, new RegExp(path.replaceAll("/", "\\/")));
  }
  for (const channel of [
    "plugin:list",
    "plugin:installFromUrl",
    "plugin:uninstall",
    "plugin:setEnabled",
    "plugin:setSetting",
    "plugin:checkUpdate",
    "plugin:applyUpdate",
    "plugin:resolveUrl",
    "plugin:invokeMenu",
    "plugin:matchLyric",
    "plugin:matchCover",
    "plugin:market",
    "plugin:status",
  ]) {
    assert.doesNotMatch(preloadSource, new RegExp(`ipcRenderer\\.invoke\\(\\"${channel}`));
  }
  assert.match(preloadSource, /ipcRenderer\.invoke\("plugin:install", filePath\)/);
  assert.match(preloadSource, /ipcRenderer\.invoke\("plugin:pickAndInstall"\)/);
  assert.match(preloadSource, /subscribe<CoreControlEvent>\("core:event"/);
});

test("Plugin projection is initialized for both Desktop and Web playback startup", () => {
  const pluginLoadIndex = playerControlSource.indexOf("void usePluginsStore().load()");
  const desktopBlockEnd = playerControlSource.indexOf(
    "void usePluginsStore().load()",
    pluginLoadIndex,
  );
  assert.ok(pluginLoadIndex >= 0);
  assert.match(
    playerControlSource,
    /if \(!webRemote\) \{[\s\S]*await useStreamingStore\(\)\.init\(\);[\s\S]*\}\s*\/\/ 插件列表来自同一 Core registry/,
  );
  assert.equal(pluginLoadIndex, desktopBlockEnd);
});

test("Web Plugin UI uses Core facade while local script picker remains Host-only", () => {
  assert.match(webApiSource, /plugins:\s*\{[\s\S]*\.\.\.pluginClient/);
  assert.match(webApiSource, /pickAndInstall: async \(\) => \(\{ ok: false, cancelled: true \}\)/);
  assert.match(settingsSchemaSource, /const controlPluginsCategory/);
  assert.match(settingsSchemaSource, /section\.id !== "pluginManage"/);
  assert.match(settingsSchemaSource, /controlPluginsCategory/);
  assert.doesNotMatch(settingsSchemaSource, /isDesktopRenderer\(\) \? \[pluginsCategory\] : \[\]/);
});
