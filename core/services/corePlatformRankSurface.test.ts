import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

const qmModulesSource = read("../apis/qqmusic/modules/index.ts");
const qmLeaderboardSource = read("../apis/qqmusic/modules/leaderboard.ts");
const qmToplistSource = read("../apis/qqmusic/modules/toplist.ts");
const kgModulesSource = read("../apis/kugou/modules/index.ts");
const kgRankSource = read("../apis/kugou/modules/rank.ts");
const kgSongCoreSource = read("../apis/kugou/core/song.ts");
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
  // 封面统一升级 https，避免混合内容拦截
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
  // rank/song 用 authors[]（与 special/song 的 singername 不同）；
  // 归一化抽在 core/song.ts，榜单与后续的新歌接口共用
  assert.match(kgRankSource, /normalizeKgAuthorSong/);
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
