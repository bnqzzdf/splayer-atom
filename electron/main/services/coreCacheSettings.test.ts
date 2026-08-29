import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serviceSource = readFileSync(new URL("./cache.ts", import.meta.url), "utf8");
const ipcSource = readFileSync(new URL("../ipc/cache.ts", import.meta.url), "utf8");
const routesSource = readFileSync(new URL("../atom/headless/routes.ts", import.meta.url), "utf8");
const webApiSource = readFileSync(new URL("../../../src/web/api.ts", import.meta.url), "utf8");
const fileCacheSource = readFileSync(
  new URL("../../../src/components/settings/custom/FileCacheManager.vue", import.meta.url),
  "utf8",
);

test("Core cache management is shared below Electron IPC", () => {
  assert.doesNotMatch(serviceSource, /from "electron"/);
  assert.match(serviceSource, /export const getCacheStats/);
  assert.match(serviceSource, /export const clearCacheCategory/);
  assert.match(serviceSource, /export const clearCacheByKind/);
  assert.match(serviceSource, /export const resetCacheDir/);
  assert.match(ipcSource, /from "@main\/services\/cache"/);
  assert.doesNotMatch(ipcSource, /categoryHandlers|clearLyricCache|dirSize/);
});

test("Headless Web exposes real Core cache stats and clearing routes", () => {
  assert.match(routesSource, /api\.get\("\/cache\/stats"/);
  assert.match(routesSource, /api\.get\("\/cache\/dir"/);
  assert.match(routesSource, /api\.post\("\/cache\/clear"/);
  assert.match(routesSource, /api\.post\("\/cache\/clear-all"/);
  assert.match(routesSource, /api\.post\("\/cache\/reset-dir"/);
  assert.match(webApiSource, /getStats: \(\) => request\("\/cache\/stats"\)/);
  assert.match(webApiSource, /clearAllByKind: async/);
  assert.match(webApiSource, /getDir: async/);
  assert.match(webApiSource, /resetDir: async/);
});

test("Web cache settings do not pretend to browse the Core filesystem locally", () => {
  assert.match(fileCacheSource, /hasHostCapability\("nativeFileDialogs"\)/);
  assert.match(fileCacheSource, /hasHostCapability\("hostFileExplorer"\)/);
  assert.match(fileCacheSource, /v-if="canPickCorePathFromHost"/);
  assert.match(fileCacheSource, /v-if="canOpenCorePathOnHost"/);
  assert.match(webApiSource, /Web Control does not provide a Core filesystem picker/);
  assert.match(webApiSource, /Core owns song-cache lookup in Web Control/);
});
