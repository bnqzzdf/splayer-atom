import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serviceSource = readFileSync(new URL("./cache.ts", import.meta.url), "utf8");
const ipcSource = readFileSync(new URL("../ipc/cache.ts", import.meta.url), "utf8");
const routesSource = readFileSync(new URL("../atom/headless/routes.ts", import.meta.url), "utf8");
const webApiSource = readFileSync(new URL("../../../src/web/api.ts", import.meta.url), "utf8");
const cacheClientSource = readFileSync(
  new URL("../../../src/core/cacheClient.ts", import.meta.url),
  "utf8",
);
const cacheStatsSource = readFileSync(
  new URL("../../../src/composables/useCacheStats.ts", import.meta.url),
  "utf8",
);
const dbCacheSource = readFileSync(
  new URL("../../../src/components/settings/custom/DbCacheManager.vue", import.meta.url),
  "utf8",
);
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
  assert.match(routesSource, /api\.post\("\/cache\/dir"/);
  assert.match(routesSource, /resolveCoreDirectory\(body\.dir\)/);
  assert.match(routesSource, /switchCacheDir\(dir\)/);
  assert.match(routesSource, /api\.post\("\/cache\/clear"/);
  assert.match(routesSource, /api\.post\("\/cache\/clear-all"/);
  assert.match(routesSource, /api\.post\("\/cache\/reset-dir"/);
  assert.match(cacheClientSource, /getStats: \(\).*"\/cache\/stats"/);
  assert.match(cacheClientSource, /setDir: \(dir: string\).*"\/cache\/dir"/s);
  assert.match(cacheClientSource, /clearAllByKind: async/);
  assert.match(cacheClientSource, /getDir: async/);
  assert.match(cacheClientSource, /resetDir: async/);
  assert.match(webApiSource, /\.\.\.cacheClient/);
});

test("Web cache settings do not pretend to browse the Core filesystem locally", () => {
  assert.match(fileCacheSource, /hasHostCapability\("nativeFileDialogs"\)/);
  assert.match(fileCacheSource, /hasHostCapability\("hostFileExplorer"\)/);
  assert.match(fileCacheSource, /v-if="canPickCorePathFromHost"/);
  assert.match(fileCacheSource, /v-if="canOpenCorePathOnHost"/);
  assert.match(ipcSource, /resolveCoreDirectory\(result\.filePaths\[0\]\)/);
  assert.doesNotMatch(ipcSource, /switchCacheDir\(result\.filePaths\[0\]\)/);
  assert.match(fileCacheSource, /cacheClient\.setDir\(result\.dir\)/);
  assert.match(cacheStatsSource, /cacheClient\.getStats\(\)/);
  assert.match(cacheStatsSource, /cacheClient\.getDir\(\)/);
  assert.match(dbCacheSource, /cacheClient\.clearAllByKind\("db"\)/);
  assert.match(webApiSource, /Web Control does not provide a Core filesystem picker/);
  assert.match(webApiSource, /Core owns song-cache lookup in Web Control/);
});
