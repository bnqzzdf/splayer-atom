import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

const service = read("core/services/lyricMatching.ts");
const routes = read("core/atom/headless/routes.ts");
const requestService = read("src/services/lyric/request.ts");
const resolveService = read("src/services/lyric/resolve.ts");
const tagEditor = read("src/components/modals/TagEditorDialog.vue");

test("Lyrics matching business lives in one Core service", () => {
  assert.match(service, /export const matchLyricById/);
  assert.match(service, /export const matchLyricByQuery/);
  assert.match(service, /export const fetchLyricTTMLOverlay/);
  assert.match(service, /export const matchCoreLocalTTML/);
  assert.doesNotMatch(service, /ipcMain|electron/);
});

test("Web lyric requests use the shared Core Protocol", () => {
  for (const path of [
    "/lyrics/match-by-id",
    "/lyrics/match-by-query",
    "/lyrics/ttml-overlay",
    "/lyrics/local",
  ]) {
    assert.match(routes, new RegExp(`api\\.post\\("${path.replaceAll("/", "\\/")}"`));
  }
  assert.match(requestService, /lyricsClient\.matchById/);
  assert.match(requestService, /lyricsClient\.matchByQuery/);
  assert.match(requestService, /lyricsClient\.fetchTTMLOverlay/);
  assert.match(resolveService, /lyricsClient\.matchLocalTTML/);
  assert.match(tagEditor, /lyricsClient\.matchById/);
  assert.doesNotMatch(requestService, /window\.api\.lyrics\./);
  assert.doesNotMatch(resolveService, /window\.api\.lyrics\.matchLocalTTML/);
  assert.doesNotMatch(tagEditor, /window\.api\.lyrics\.matchById/);
  assert.match(
    read("src/components/settings/custom/LocalLyricRepoConfig.vue"),
    /CoreDirectoryPicker/,
  );
});
