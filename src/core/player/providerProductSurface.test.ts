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
const providerSessionsSource = readFileSync(
  new URL("../../stores/providerSessions.ts", import.meta.url),
  "utf8",
);
const streamingStoreSource = readFileSync(
  new URL("../../stores/streaming.ts", import.meta.url),
  "utf8",
);

test("Atom formal renderer exposes only managed online search providers", () => {
  assert.match(
    searchPageSource,
    /atomSearchPlatforms = new Set<Platform>\(\["netease", "qobuz", "tidal"\]\)/,
  );
  assert.match(searchPageSource, /atomSearchPlatforms\.has\(status\.searchPlatform\)/);
  assert.match(
    searchPageSource,
    /atomSearchPlatforms\.has\(key\) && isSearchPlatformAvailable\(key\)/,
  );
  assert.match(searchPageSource, /providerSessions\.isAuthenticated\(platform\)/);
  assert.match(searchPageSource, /providerSessions\.initialized/);
  assert.match(providerSessionsSource, /const initialized = ref\(false\)/);
  assert.doesNotMatch(
    searchPageSource,
    /searchSource\.value === "qobuz" \|\| searchSource\.value === "tidal"[\s\S]{0,80}items\.slice\(0, 1\)/,
  );
  assert.match(statusStoreSource, /searchPlatform = ref<Platform>\("netease"\)/);

  assert.doesNotMatch(searchApiSource, /\.\/qqmusic|\.\/kugou/);
  assert.match(pluginPlaybackSource, /qqmusic: "tx"/);
  assert.match(pluginPlaybackSource, /kugou: "kg"/);
});

test("Web reuses the library API for local song album and artist search", () => {
  assert.match(searchPageSource, /\{ key: "local", label: t\("search\.source\.local"\) \}/);
  assert.match(searchPageSource, /searchSource\.value === "local".*items\.slice\(0, 3\)/);
  assert.match(searchPageSource, /libraryClient\.searchTracks\(requestKeyword\)/);
  assert.match(searchPageSource, /libraryClient\.getAlbums\(\)/);
  assert.match(searchPageSource, /libraryClient\.getArtists\(\)/);
  assert.match(searchPageSource, /source: searchSource, albumId: item\.id/);
  assert.match(searchPageSource, /source: searchSource, artistId: item\.id/);
  assert.doesNotMatch(searchPageSource, /webSearchPlatforms/);
});

test("Media source search reuses the Core streaming search projection", () => {
  assert.match(searchPageSource, /type SearchSource = Platform \| "local" \| "streaming"/);
  assert.match(searchPageSource, /useStreamingStore\(\)/);
  assert.match(searchPageSource, /void streaming\.init\(\)/);
  assert.match(searchPageSource, /key: "streaming", label: t\("search\.source\.streaming"\)/);
  assert.match(searchPageSource, /response = await streaming\.search\(requestKeyword\)/);
  assert.match(searchPageSource, /response\.playlists\.map/);
  assert.match(searchPageSource, /source: searchSource, name: item\.title/);
  assert.match(streamingStoreSource, /streamingClient\.search\(activeServerId\.value, query\)/);
  assert.doesNotMatch(searchPageSource, /atomSearchPlatforms = new Set<Platform>\([^\n]*streaming/);
});

test("Web Netease account pages reuse the shared Core provider surface", () => {
  assert.match(favoritesPageSource, /useUserStore\(\)/);
  assert.match(dailyPageSource, /useUserStore\(\)/);
  assert.match(dailyPageSource, /data\.ensureDailyRecommend\(true\)/);
  assert.match(cloudPageSource, /useUserStore\(\)/);
  assert.doesNotMatch(cloudPageSource, /hasHostCapability|cloudUploadAvailable|CloudUploadDialog/);
  assert.match(userStoreSource, /useProviderSessionsStore\(\)/);
  assert.match(userStoreSource, /providerSessions\.isAuthenticated\("netease"\)/);
  assert.match(neteaseApiSource, /providerClient\.call\("netease", name, params\)/);
  assert.match(neteaseApiSource, /providerClient\.clearSession\("netease"\)/);
  assert.doesNotMatch(favoritesPageSource, /window\.api\.apis/);
  assert.doesNotMatch(dailyPageSource, /window\.api\.apis/);
  assert.doesNotMatch(cloudPageSource, /window\.api\.apis/);
});
