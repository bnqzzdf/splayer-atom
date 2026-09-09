import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serviceSource = readFileSync(new URL("./pluginControl.ts", import.meta.url), "utf8");
const routesSource = readFileSync(new URL("../atom/headless/routes.ts", import.meta.url), "utf8");
const coreEventsSource = readFileSync(
  new URL("../../shared/types/coreEvents.ts", import.meta.url),
  "utf8",
);
const eventClientSource = readFileSync(
  new URL("../../src/core/controlEventClient.ts", import.meta.url),
  "utf8",
);
const pluginClientSource = readFileSync(
  new URL("../../src/core/pluginClient.ts", import.meta.url),
  "utf8",
);
const settingsSchemaSource = readFileSync(
  new URL("../../src/settings/schema.ts", import.meta.url),
  "utf8",
);
const nodeCoreSource = readFileSync(new URL("../core-node/index.ts", import.meta.url), "utf8");
const playerControlSource = readFileSync(
  new URL("../../src/core/player/index.ts", import.meta.url),
  "utf8",
);
const pluginStoreSource = readFileSync(
  new URL("../../src/stores/plugins.ts", import.meta.url),
  "utf8",
);
const pluginImportSource = readFileSync(
  new URL("../../src/components/settings/custom/PluginImport.vue", import.meta.url),
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

test("Plugin status uses the unified CoreControlEvent envelope", () => {
  assert.match(coreEventsSource, /type: "pluginStatus"; data: PluginInfo/);
  assert.match(serviceSource, /publishCoreControlEvent\(\{ type: "pluginStatus", data: info \}\)/);
  assert.match(eventClientSource, /event\.type === "pluginStatus"/);
  assert.match(pluginClientSource, /subscribeCoreControlEvent\("pluginStatus", callback\)/);
  assert.match(nodeCoreSource, /registerPluginControlEvents\(\)/);
  assert.match(nodeCoreSource, /unregisterPluginControlEvents\(\)/);
});

test("Plugin projection is initialized during Web playback startup", () => {
  const pluginLoadIndex = playerControlSource.indexOf("void usePluginsStore().load()");
  assert.ok(pluginLoadIndex >= 0);
  assert.doesNotMatch(playerControlSource, /webRemote|isWebRemote|window\.api\.plugins/);
});

test("Web Plugin UI uses the Core client and URL installation only", () => {
  assert.match(pluginStoreSource, /import \{ pluginClient \} from "@\/core\/pluginClient"/);
  assert.match(pluginStoreSource, /pluginClient\.list\(\)/);
  assert.match(pluginStoreSource, /pluginClient\.installFromUrl\(url\)/);
  assert.match(pluginStoreSource, /pluginClient\.onStatus/);
  assert.doesNotMatch(pluginStoreSource, /window\.api|pickAndInstall/);
  assert.doesNotMatch(pluginImportSource, /handleImportLocal|importLocal|pickAndInstall/);
  assert.match(pluginImportSource, /installFromUrl\(url\)/);
  assert.match(settingsSchemaSource, /pluginsCategory/);
  assert.doesNotMatch(settingsSchemaSource, /isDesktopRenderer|hasHostCapability/);
});
