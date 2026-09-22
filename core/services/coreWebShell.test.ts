import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative: string): string =>
  readFileSync(new URL(`../../${relative}`, import.meta.url), "utf8");

const mainSource = read("src/main.ts");
const runtimeCssSource = read("src/web/runtime.css");
const mainLayoutSource = read("src/layouts/MainLayout.vue");
const fullPlayerSource = read("src/components/player/FullPlayer/index.vue");

test("Web Control is the only renderer bootstrap path", () => {
  assert.doesNotMatch(mainSource, /services\/client\/webPolyfill/);
  assert.match(mainSource, /await useSettingsStore\(\)\.syncSystem\(\)/);
  assert.doesNotMatch(
    mainSource,
    /installWebApi|web\/api|electron|ipcRenderer|atomRuntime|desktop/i,
  );
});

test("Web Control keeps the Atom navigation shell and persistent player bar", () => {
  assert.match(mainLayoutSource, /<SideBar \/>/);
  assert.match(mainLayoutSource, /showPlayerBar = computed\(\(\) => true\)/);
  assert.doesNotMatch(mainLayoutSource, /isWebRemote|useMediaStore/);
  assert.doesNotMatch(runtimeCssSource, /data-atom-runtime="desktop"/);
});

test("FullPlayer remains the pointer-event shield while modal menus lock the body", () => {
  assert.match(
    fullPlayerSource,
    /class="fixed inset-0 z-200 overflow-hidden text-cover pointer-events-auto"/,
  );
});
