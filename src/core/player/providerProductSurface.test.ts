import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const searchPageSource = readFileSync(new URL("../../pages/Search.vue", import.meta.url), "utf8");
const searchApiSource = readFileSync(
  new URL("../../apis/search/index.ts", import.meta.url),
  "utf8",
);
const pluginPlaybackSource = readFileSync(
  new URL("../../../shared/utils/pluginPlayback.ts", import.meta.url),
  "utf8",
);
const statusStoreSource = readFileSync(new URL("../../stores/status.ts", import.meta.url), "utf8");

test("Atom formal search surface freezes QQ Music and Kugou without deleting compatibility", () => {
  assert.match(
    searchPageSource,
    /atomSearchPlatforms = new Set<Platform>\(\["netease", "qobuz", "tidal"\]\)/,
  );
  assert.match(searchPageSource, /atomSearchPlatforms\.has\(status\.searchPlatform\)/);
  assert.match(
    searchPageSource,
    /ALL_PLATFORMS\.filter\(\(key\) => atomSearchPlatforms\.has\(key\)\)/,
  );
  assert.match(statusStoreSource, /searchPlatform = ref<Platform>\("netease"\)/);

  assert.match(searchApiSource, /import \* as qqmusic from "\.\/qqmusic"/);
  assert.match(searchApiSource, /import \* as kugou from "\.\/kugou"/);
  assert.match(pluginPlaybackSource, /qqmusic: "tx"/);
  assert.match(pluginPlaybackSource, /kugou: "kg"/);
});

test("Desktop and Web reuse the library API for local song album and artist search", () => {
  assert.match(searchPageSource, /\{ key: "local", label: t\("search\.source\.local"\) \}/);
  assert.match(searchPageSource, /searchSource\.value === "local".*items\.slice\(0, 3\)/);
  assert.match(searchPageSource, /libraryClient\.searchTracks\(requestKeyword\)/);
  assert.match(searchPageSource, /libraryClient\.getAlbums\(\)/);
  assert.match(searchPageSource, /libraryClient\.getArtists\(\)/);
  assert.match(searchPageSource, /source: searchSource, albumId: item\.id/);
  assert.match(searchPageSource, /source: searchSource, artistId: item\.id/);
  assert.doesNotMatch(searchPageSource, /webSearchPlatforms/);
});
