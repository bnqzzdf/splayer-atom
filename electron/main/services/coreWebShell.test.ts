import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative: string): string =>
  readFileSync(new URL(`../../../${relative}`, import.meta.url), "utf8");

const mainSource = read("src/main.ts");
const runtimeCssSource = read("src/web/runtime.css");
const mainLayoutSource = read("src/layouts/MainLayout.vue");

test("Web Control runtime detection happens before any window.api compatibility layer", () => {
  assert.doesNotMatch(mainSource, /services\/client\/webPolyfill/);
  assert.match(mainSource, /"electron" in window/);
  assert.match(mainSource, /"ipcRenderer" in window\.electron/);
  assert.match(mainSource, /document\.documentElement\.dataset\.atomRuntime = "web"/);
  assert.match(mainSource, /await installWebApi\(\)/);
});

test("Web Control keeps the Atom navigation shell and persistent player bar", () => {
  assert.match(mainLayoutSource, /<SideBar \/>/);
  assert.match(
    mainLayoutSource,
    /showPlayerBar = computed\(\(\) => isWebRemote\(\) \|\| !!useMediaStore\(\)\.track\)/,
  );
  assert.match(runtimeCssSource, /html\[data-atom-runtime="web"\].*window-control-button/s);
});
