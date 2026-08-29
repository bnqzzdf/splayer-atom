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
  assert.match(searchPageSource, /webSearchPlatforms = new Set<Platform>\(\["netease"\]\)/);
  assert.match(searchPageSource, /availableSearchPlatforms\.has\(status\.searchPlatform\)/);
  assert.match(
    searchPageSource,
    /ALL_PLATFORMS\.filter\(\(key\) => availableSearchPlatforms\.has\(key\)\)/,
  );
  assert.match(statusStoreSource, /searchPlatform = ref<Platform>\("netease"\)/);

  assert.match(searchApiSource, /import \* as qqmusic from "\.\/qqmusic"/);
  assert.match(searchApiSource, /import \* as kugou from "\.\/kugou"/);
  assert.match(pluginPlaybackSource, /qqmusic: "tx"/);
  assert.match(pluginPlaybackSource, /kugou: "kg"/);
});
