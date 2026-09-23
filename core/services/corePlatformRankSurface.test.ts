import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

const platformHomeSource = read("../../src/pages/PlatformHome.vue");
const qmModulesSource = read("../apis/qqmusic/modules/index.ts");
const qmLeaderboardSource = read("../apis/qqmusic/modules/leaderboard.ts");
const qmToplistSource = read("../apis/qqmusic/modules/toplist.ts");
const kgModulesSource = read("../apis/kugou/modules/index.ts");
const kgRankSource = read("../apis/kugou/modules/rank.ts");
const kgSongCoreSource = read("../apis/kugou/core/song.ts");
const kgSquareSource = read("../apis/kugou/modules/playlist_square.ts");
const kgNewSongSource = read("../apis/kugou/modules/newsong.ts");
const qmSquareSource = read("../apis/qqmusic/modules/playlist_square.ts");
const qmPlaylistApiSource = read("../../src/apis/playlist/qqmusic.ts");
const kgPlaylistApiSource = read("../../src/apis/playlist/kugou.ts");
const collectionTypesSource = read("../../src/types/collection.ts");
const qmCollectionSource = read("../../src/services/collection/qqmusic.ts");
const kgCollectionSource = read("../../src/services/collection/kugou.ts");
const navigateSource = read("../../src/utils/navigate.ts");
const shareUrlSource = read("../../src/utils/format/shareUrl.ts");
const playerTypesSource = read("../../shared/types/player.ts");

test("QM leaderboard reads the web toplist payload that actually carries songmid", () => {
  // musicu 的 ToplistInfoServer/GetDetail 只给 songId，没有 songmid，取流会全部失败；
  // 因此必须走 Web 榜单接口并解开 songlist[].data 这一层。
  assert.match(qmLeaderboardSource, /fcg_v8_toplist_cp\.fcg/);
  assert.match(qmLeaderboardSource, /\.map\(\(entry\) => entry\?\.data \?\?/);
  assert.match(qmLeaderboardSource, /mid: item\.songmid \?\? ""/);
  assert.match(qmLeaderboardSource, /mediaMid: item\.strMediaMid \?\? ""/);
  // 缺 songmid 的条目要被丢掉，不能产出无法播放的 Track
  assert.match(qmLeaderboardSource, /Boolean\(item\?\.songmid\)/);
  // 封面统一升级 https，避免混合内容拦截（只匹配正则字面量本身，不受 prettier 折行影响）
  assert.match(qmLeaderboardSource, /\^http:\\\/\\\/\//);
  assert.doesNotMatch(qmLeaderboardSource, /songInfoList/);
});

test("QM toplist directory is exposed and registered", () => {
  assert.match(qmToplistSource, /musicToplist\.ToplistInfoServer",\s*"GetAll"/);
  assert.match(qmToplistSource, /groups/);
  assert.match(qmModulesSource, /import toplist from "\.\/toplist"/);
  assert.match(qmModulesSource, /^\s*toplist,$/m);
  // 目录接口同样要把 http 头图升级为 https
  assert.match(qmToplistSource, /\^http:\\\/\\\/\//);
});

test("KG rank module covers directory and detail and is registered", () => {
  assert.match(kgRankSource, /api\/v3\/rank\/list/);
  assert.match(kgRankSource, /api\/v3\/rank\/song/);
  assert.match(kgRankSource, /api\/v3\/rank\/info/);
  // 榜单歌曲用 authors[]（与 special/song 的 singername 不同）；归一化已抽到 core/song
  assert.match(kgSongCoreSource, /raw\.authors/);
  // 320k 需要回退到 _high 系列
  assert.match(kgSongCoreSource, /raw\["320hash"\] \|\| raw\.hash_high/);
  assert.match(kgModulesSource, /rank_list: rankList/);
  assert.match(kgModulesSource, /rank_detail: rankDetail/);
});

test("rank is a first-class collection type with loaders and share URLs", () => {
  assert.match(collectionTypesSource, /"album" \| "playlist" \| "radio" \| "cloud" \| "rank"/);
  assert.match(playerTypesSource, /\|\s*"rank"/);
  assert.match(navigateSource, /export const navigateToRank/);
  assert.match(qmCollectionSource, /if \(type === "rank"\)/);
  assert.match(qmCollectionSource, /fetchQQMusicRank/);
  assert.match(kgCollectionSource, /if \(type === "rank"\)/);
  assert.match(kgCollectionSource, /fetchKugouRank/);
  // rank 是 Record<CollectionType, ...> 的键，缺了会导致其它类型分享链接取不到
  assert.match(shareUrlSource, /^\s*rank: \{$/m);
});

test("platform home lists all four platforms and routes rank cards to the rank page", () => {
  assert.match(platformHomeSource, /type Platform = "qobuz" \| "tidal" \| "qqmusic" \| "kugou"/);
  assert.match(
    platformHomeSource,
    /const ALL_PLATFORMS: Platform\[\] = \["qobuz", "tidal", "qqmusic", "kugou"\]/,
  );
  assert.match(platformHomeSource, /fetchQQMusicToplist/);
  assert.match(platformHomeSource, /fetchKugouRankList/);
  assert.match(platformHomeSource, /navigateToRank\(item\.id, \{ source, name: item\.title \}\)/);
  // 未登录的平台不出现在标签里
  assert.match(
    platformHomeSource,
    /ALL_PLATFORMS\.filter\(\(p\) => providerSessions\.sessions\[p\]\?\.authenticated\)/,
  );
});

test("home shelves use the channels that are actually reachable, not the gated app modules", () => {
  // QM：只能走歌单广场老 CGI；musicu 的 MusicHallPlatform 对所有请求都回 500005
  // （注释里会提到该模块名，所以这里断言的是「没有真的去请求 musicu」，而不是「文中不出现」）
  assert.match(qmSquareSource, /fcg_get_diss_by_tag\.fcg/);
  assert.doesNotMatch(qmSquareSource, /u\.y\.qq\.com/);
  assert.match(qmModulesSource, /hot_playlists: playlistSquare/);
  assert.match(qmPlaylistApiSource, /export const fetchQQMusicHotPlaylists/);

  // KG：mobilecdn 没有新歌/推荐歌单路径（全 Access Deny），走移动站频道
  assert.match(kgSquareSource, /m\.kugou\.com\/plist\/index&json=true/);
  assert.match(kgNewSongSource, /m\.kugou\.com\/newsong\/index&json=true/);
  assert.match(kgModulesSource, /hot_playlists: playlistSquare/);
  assert.match(kgModulesSource, /new_songs: newSong/);
  assert.match(kgPlaylistApiSource, /export const fetchKugouHotPlaylists/);
  assert.match(kgPlaylistApiSource, /export const fetchKugouNewSongs/);
});

test("KG author-song normalizer is shared so rank and new songs cannot drift apart", () => {
  // 新歌与榜单的原始结构同族（authors[]），必须共用同一份归一化，
  // 否则会出现「榜单能播、新歌不能播」这类字段偏差。
  assert.match(kgRankSource, /normalizeKgAuthorSong/);
  assert.match(kgNewSongSource, /normalizeKgAuthorSong/);
  assert.doesNotMatch(kgRankSource, /const normalizeRankSong/);
  assert.match(kgSongCoreSource, /export const normalizeKgAuthorSong/);
  // 320k 回退与封面模板替换属于关键行为，留在共享实现里
  assert.match(kgSongCoreSource, /raw\["320hash"\] \|\| raw\.hash_high/);
  assert.match(kgSongCoreSource, /fillCover\(raw\.trans_param\?\.union_cover/);
});

test("platform home renders the shelves ahead of the rank groups", () => {
  assert.match(platformHomeSource, /fetchQQMusicHotPlaylists/);
  assert.match(platformHomeSource, /fetchKugouHotPlaylists/);
  assert.match(platformHomeSource, /fetchKugouNewSongs/);
  assert.match(platformHomeSource, /qmHotPlaylistSection/);
  assert.match(platformHomeSource, /kgHotPlaylistSection/);
  assert.match(platformHomeSource, /kgNewSongSection/);
  // 书架拉取失败不能拖垮榜单：每个书架都带 catch 兜底
  assert.match(platformHomeSource, /fetchQQMusicHotPlaylists\(30\)\.catch/);
  assert.match(platformHomeSource, /fetchKugouHotPlaylists\(1, 30\)\.catch/);
  assert.match(platformHomeSource, /fetchKugouNewSongs\(30\)\.catch/);
  // 书架排在榜单之前
  assert.match(
    platformHomeSource,
    /\.\.\.\(hotPlaylists\.length \? \[kgHotPlaylistSection\(hotPlaylists\)\] : \[\]\)[\s\S]{0,200}\.\.\.normalizeKugou\(visible\)/,
  );
});
