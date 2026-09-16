import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string): string =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const routerSource = read("router/index.ts");
const songsSource = read("pages/Songs.vue");
const localListSource = read("pages/LocalList.vue");
const localLibrarySettingsSource = read("components/settings/custom/LocalLibrarySettings.vue");

test("local browsing uses Home Albums Artists Songs with /library compatibility only", () => {
  assert.match(routerSource, /path: "songs"[\s\S]*name: "songs"[\s\S]*pages\/Songs\.vue/);
  assert.match(routerSource, /path: "library",\s*redirect: "\/songs"/);
});

test("Songs is a pure browsing page while local library maintenance lives in Settings", () => {
  assert.doesNotMatch(songsSource, /FolderManager|startScan\(|cancelScan\(|scanProgress|scanDirs/);
  assert.match(localLibrarySettingsSource, /FolderManager/);
  assert.match(
    localLibrarySettingsSource,
    /if \(!initialized\.value\) await libraryStore\.load\(\)/,
  );
  assert.match(localLibrarySettingsSource, /libraryStore\.startScan\(true\)/);
  assert.match(localLibrarySettingsSource, /libraryStore\.startScan\(false\)/);
  assert.match(localLibrarySettingsSource, /libraryStore\.cancelScan\(\)/);
});

test("album and artist local lists own page-local search instead of adding a Core search path", () => {
  assert.match(localListSource, /const searchQuery = ref\(""\)/);
  assert.match(localListSource, /`\$\{album\.name\}\\n\$\{album\.artist\}`/);
  assert.match(localListSource, /ArtistSummary\)\.name\.toLocaleLowerCase\(\)\.includes\(query\)/);
});
