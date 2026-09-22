import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serviceSource = readFileSync(new URL("./cache.ts", import.meta.url), "utf8");
const routesSource = readFileSync(new URL("../atom/headless/routes.ts", import.meta.url), "utf8");
const cacheClientSource = readFileSync(
  new URL("../../src/core/cacheClient.ts", import.meta.url),
  "utf8",
);
const cacheStatsSource = readFileSync(
  new URL("../../src/composables/useCacheStats.ts", import.meta.url),
  "utf8",
);
const dbCacheSource = readFileSync(
  new URL("../../src/components/settings/custom/DbCacheManager.vue", import.meta.url),
  "utf8",
);
const fileCacheSource = readFileSync(
  new URL("../../src/components/settings/custom/FileCacheManager.vue", import.meta.url),
  "utf8",
);

test("Core cache management lives in one runtime service", () => {
  assert.doesNotMatch(serviceSource, /from "electron"|ipcMain/);
  assert.match(serviceSource, /export const getCacheStats/);
  assert.match(serviceSource, /export const clearCacheCategory/);
  assert.match(serviceSource, /export const clearCacheByKind/);
  assert.match(serviceSource, /export const resetCacheDir/);
});

test("Web Control exposes real Core cache stats and clearing routes", () => {
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
});

test("Web cache settings browse the Core filesystem through CoreDirectoryPicker", () => {
  assert.match(fileCacheSource, /CoreDirectoryPicker/);
  assert.match(fileCacheSource, /cacheClient\.setDir\(dir\)/);
  assert.doesNotMatch(fileCacheSource, /hasHostCapability|showInExplorer|window\.api\.cache/);
  assert.match(cacheStatsSource, /cacheClient\.getStats\(\)/);
  assert.match(cacheStatsSource, /cacheClient\.getDir\(\)/);
  assert.match(dbCacheSource, /cacheClient\.clearAllByKind\("db"\)/);
});
