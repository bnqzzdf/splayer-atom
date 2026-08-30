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
const favoritesPageSource = readFileSync(
  new URL("../../pages/Favorites.vue", import.meta.url),
  "utf8",
);
const dailyPageSource = readFileSync(new URL("../../pages/Daily.vue", import.meta.url), "utf8");
const cloudPageSource = readFileSync(new URL("../../pages/Cloud.vue", import.meta.url), "utf8");
const userStoreSource = readFileSync(new URL("../../stores/user.ts", import.meta.url), "utf8");
const neteaseApiSource = readFileSync(new URL("../../apis/netease.ts", import.meta.url), "utf8");

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

test("Headless Web Netease account pages reuse the shared Core provider surface", () => {
  assert.match(favoritesPageSource, /useUserStore\(\)/);
  assert.match(dailyPageSource, /useUserStore\(\)/);
  assert.match(dailyPageSource, /data\.ensureDailyRecommend\(true\)/);
  assert.match(cloudPageSource, /useUserStore\(\)/);
  assert.match(cloudPageSource, /hasHostCapability\("cloudUpload"\)/);
  assert.match(cloudPageSource, /v-if="cloudUploadAvailable"/);
  assert.match(userStoreSource, /useProviderSessionsStore\(\)/);
  assert.match(userStoreSource, /providerSessions\.isAuthenticated\("netease"\)/);
  assert.match(neteaseApiSource, /providerClient\.call\("netease", name, params\)/);
  assert.match(neteaseApiSource, /providerClient\.clearSession\("netease"\)/);
  assert.doesNotMatch(favoritesPageSource, /window\.api\.apis/);
  assert.doesNotMatch(dailyPageSource, /window\.api\.apis/);
  assert.doesNotMatch(cloudPageSource, /window\.api\.apis/);
});
