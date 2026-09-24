import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

const searchPageSource = read("../../src/pages/Search.vue");
const capabilitiesStoreSource = read("../../src/stores/coreCapabilities.ts");
const hotSource = read("../../src/apis/search/hot.ts");
const suggestSource = read("../../src/apis/search/suggest.ts");
const navSearchSource = read("../../src/components/layout/NavSearch.vue");
const artistLoaderSource = read("../../src/services/artistLoader.ts");
const artistPageSource = read("../../src/pages/Artist.vue");
const qqArtistSource = read("../../src/apis/artist/qqmusic.ts");
const kgArtistSource = read("../../src/apis/artist/kugou.ts");

test("search platform tabs are gated by the Core capability projection", () => {
  // Core 不声明某平台时，该平台不能出现搜索入口。
  assert.match(capabilitiesStoreSource, /getCoreInfo\(\)/);
  assert.match(capabilitiesStoreSource, /supportsPlatform = \(platform: ManagedProviderPlatform\)/);
  assert.match(capabilitiesStoreSource, /capabilities\.value\[platform\] !== false/);

  assert.match(searchPageSource, /useCoreCapabilitiesStore\(\)/);
  assert.match(searchPageSource, /coreCapabilities\.supportsPlatform\(platform\)/);
  assert.match(searchPageSource, /ALL_PLATFORMS\.filter\(isSearchPlatformAvailable\)/);
  // 能力位与登录态都就绪后才判定，未就绪时不误退回本地。
  assert.match(searchPageSource, /if \(!sessionsReady \|\| !capabilitiesReady\) return/);
});

test("hot search and suggestions follow the selected online platform", () => {
  assert.match(hotSource, /getHotSearches = async \(\s*platform: Platform = "netease",?\s*\)/);
  assert.match(hotSource, /const cache = new Map<Platform,/);
  assert.match(hotSource, /if \(platform === "netease"\) items = await loadNeteaseHot\(\)/);
  assert.match(hotSource, /else if \(platform === "qqmusic"\) items = await loadQQMusicHot\(\)/);
  assert.match(hotSource, /qqmusicCall<QQMusicHotResp>\("hot_search"\)/);

  assert.match(
    suggestSource,
    /getSearchSuggest = async \(\s*keyword: string,\s*platform: Platform = "netease",?\s*\)/,
  );
  assert.match(
    suggestSource,
    /if \(platform === "netease"\) return \{ \.\.\.\(await neteaseSuggest\(word\)\), platform \}/,
  );
  assert.match(
    suggestSource,
    /if \(platform === "qqmusic"\) return \{ \.\.\.\(await qqmusicSuggest\(word\)\), platform \}/,
  );
  assert.match(suggestSource, /qqSongToTrack\(song\)/);

  // 界面必须把平台传下去，并且点击时不再硬编码网易云。
  assert.match(navSearchSource, /getHotSearches\(activePlatform\.value\)/);
  assert.match(navSearchSource, /getSearchSuggest\(keyword, activePlatform\.value\)/);
  assert.match(navSearchSource, /coreCapabilities\.supportsPlatform\(status\.searchPlatform\)/);
  assert.match(navSearchSource, /entry\.source \?\? suggest\.value\.platform/);
  assert.match(navSearchSource, /if \(entry\.track\) \{/);
  assert.doesNotMatch(navSearchSource, /navigateToResource\(kind, String\(id\), "netease", name\)/);
});

test("artist page pagination is owned by the source, not by the page", () => {
  // 契约：来源返回分页描述，页面只消费它。
  assert.match(artistLoaderSource, /export interface ArtistPagination \{/);
  assert.match(artistLoaderSource, /loadMore: \(offset: number, limit: number\)/);
  assert.match(
    artistLoaderSource,
    /export const loadArtist = async \([^)]*\): Promise<ArtistPagination \| null>/,
  );
  assert.match(artistLoaderSource, /fetchNeteaseArtistSongs\(artistId, offset, limit\)/);
  assert.match(artistLoaderSource, /fetchQQMusicArtistSongs\(artistId, offset, limit\)/);
  assert.match(artistLoaderSource, /fetchKugouArtistSongs\(artistId, offset, limit\)/);

  // QM/KG 必须真的提供分页函数，而不是移植后闲置。
  assert.match(qqArtistSource, /export const fetchQQMusicArtistSongs/);
  assert.match(kgArtistSource, /export const fetchKugouArtistSongs/);

  // 页面不再按平台分支决定分页，也不再直接依赖网易云的 API。
  assert.match(artistPageSource, /page\.loadMore\(current\.tracks\.length, 50\)/);
  assert.match(artistPageSource, /pagination\.value = page/);
  assert.doesNotMatch(artistPageSource, /source !== "netease" \|\| !hasMoreSongs/);
  assert.doesNotMatch(artistPageSource, /source === "netease" && next\.tracks\.length >= 50/);
  assert.doesNotMatch(artistPageSource, /apis\/artist\/netease/);
});
