import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

/** 去掉注释行，只留代码——负向断言不该被"解释为什么不用它"的注释绊倒 */
const codeOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

const qmModulesSource = read("core/apis/qqmusic/modules/index.ts");
const qmNewSongSource = read("core/apis/qqmusic/modules/newsong.ts");
const qmNewAlbumSource = read("core/apis/qqmusic/modules/newalbum.ts");
const kgModulesSource = read("core/apis/kugou/modules/index.ts");
const kgNewSongSource = read("core/apis/kugou/modules/newsong.ts");
const kgHotArtistSource = read("core/apis/kugou/modules/hot_artist.ts");
const qmPlaylistApiSource = read("src/apis/playlist/qqmusic.ts");
const kgPlaylistApiSource = read("src/apis/playlist/kugou.ts");
const platformHomePageSource = read("src/pages/PlatformHome.vue");
const platformSectionPageSource = read("src/pages/PlatformSection.vue");
const platformHomeServiceSource = read("src/services/platformHome.ts");
const zhLocale = JSON.parse(read("src/i18n/locales/zh-CN.json")) as {
  platformHome: Record<string, unknown>;
};
const enLocale = JSON.parse(read("src/i18n/locales/en-US.json")) as {
  platformHome: Record<string, unknown>;
};

test("流媒体接入的标签顺序按使用频率排，与共享层那份互不影响", () => {
  // 这份只管平台页标签（@shared/types/platform 那份管搜索页与标签编辑器、含网易云）
  assert.match(
    platformHomeServiceSource,
    /ALL_PLATFORMS: Platform\[\] = \["qqmusic", "qobuz", "tidal", "kugou"\]/,
  );
  assert.match(
    platformHomePageSource,
    /ALL_PLATFORMS\.filter\(\(p\) => providerSessions\.sessions\[p\]\?\.authenticated\)/,
  );
});

test("QM 新歌首发走 musicu 且自带取流字段", () => {
  assert.match(qmNewSongSource, /"newsong\.NewSongServer"/);
  assert.match(qmNewSongSource, /"get_new_song_info"/);
  // 榜单那条通道拿不到 mid，新歌这条自带 media_mid，取流才能成立
  assert.match(qmNewSongSource, /mediaMid: song\.file\?\.media_mid/);
  // 地区维度就是接口自己下发的 lanlist 的 type 字段
  assert.match(qmNewSongSource, /\{ type \}/);
  assert.match(qmModulesSource, /new_songs: newSong/);
  assert.match(qmPlaylistApiSource, /qmApi\.new_songs</);
  assert.match(platformHomePageSource, /newSongSection\("qm-new-songs"/);
});

test("QM 新碟首发的地区参数是 area，不是 albumType / type", () => {
  assert.match(qmNewAlbumSource, /"newalbum\.NewAlbumServer"/);
  assert.match(qmNewAlbumSource, /"get_new_album_info"/);
  assert.match(qmNewAlbumSource, /\{ area, num, page \}/);
  // 实测三者都不抛异常：type 回 code=10006、albumType 被静默忽略（任何值都同一份数据）、
  // 空对象回 code=2000 且 albums 为空。不用多值验证就会误判成"该接口没有地区筛选"。
  assert.doesNotMatch(codeOnly(qmNewAlbumSource), /albumType/);
  assert.match(qmModulesSource, /new_albums: newAlbum/);
  assert.match(qmPlaylistApiSource, /qmApi\.new_albums</);
  assert.match(platformHomePageSource, /qmNewAlbumSection\(newAlbums\)/);
});

test("KG 新歌用移动站频道的 type 区分地区", () => {
  assert.match(kgNewSongSource, /m\.kugou\.com\/newsong\/index&json=true&type=\$\{type\}/);
  // 3 与 6 会被上游回落到华语，所以只暴露 1/2/4/5
  assert.match(kgNewSongSource, /params\.type \?\? 1/);
  assert.match(kgModulesSource, /new_songs: newSong/);
  assert.match(
    platformHomePageSource,
    /fetchKugouNewSongs\(30, Number\(shelfTab\("kg-new-songs"\)\)\)/,
  );
});

test("KG 热门歌手读 data.info 且按 type 区分地区", () => {
  assert.match(kgHotArtistSource, /api\/v5\/singer\/list\?sort=1/);
  // v3 的 singer/rank、singer/list 在该通道一律 Access Deny
  assert.doesNotMatch(codeOnly(kgHotArtistSource), /api\/v3\/singer/);
  // 条目在 info 里，没有 data.list 这个键（按 list 取会拿到空数组）
  assert.doesNotMatch(codeOnly(kgHotArtistSource), /data\.list/);
  assert.match(kgHotArtistSource, /\(data\.info \?\? \[\]\)/);
  assert.match(kgHotArtistSource, /&type=\$\{type\}/);
  // singerid 与榜单 authors[].author_id 同一 id 空间，可直接进歌手详情
  assert.match(kgHotArtistSource, /singerid/);
  assert.match(kgModulesSource, /hot_artists: hotArtist/);
  assert.match(kgPlaylistApiSource, /kgApi\.hot_artists</);
});

test("四个书架的地区标签与取值都登记在 SHELF_TABS 里", () => {
  for (const shelf of ["qm-new-songs", "qm-new-albums", "kg-new-songs", "kg-hot-artists"]) {
    assert.ok(platformHomeServiceSource.includes(`"${shelf}": [`), `缺少 ${shelf} 的标签表`);
  }
  // QM 新歌：接口 lanlist 给的顺序（最新 / 内地 / 港台 / 欧美 / 韩国 / 日本）
  assert.match(
    platformHomeServiceSource,
    /"qm-new-songs": \[\s*\{ value: "5", labelKey: "platformHome\.region\.latest" \}/,
  );
  // QM 新碟：实测 total 依次 4395 / 1096 / 6170 / 1642 / 1653
  assert.match(
    platformHomeServiceSource,
    /"qm-new-albums": \[\s*\{ value: "1", labelKey: "platformHome\.region\.mainland" \}/,
  );
  // KG 热门歌手：取值与接口自带的 enu_list.types 一致（韩国是 6、日本是 5，顺序不能想当然）
  assert.match(
    platformHomeServiceSource,
    /\{ value: "6", labelKey: "platformHome\.region\.korea" \}/,
  );
  assert.match(
    platformHomeServiceSource,
    /\{ value: "5", labelKey: "platformHome\.region\.japan" \}/,
  );
});

test("点地区标签只重载对应书架，且「更多」把书架与地区带到分区页", () => {
  assert.match(
    platformHomePageSource,
    /const selectShelfTab = async \(section: HomeSection, value: string\)/,
  );
  assert.match(platformHomePageSource, /@click="selectShelfTab\(section, tab\.value\)"/);
  // withShelf 给书架挂 tabs / activeTab / more，more 里带着当前地区
  assert.match(
    platformHomePageSource,
    /more: \{ platform: platform\.value, section: section\.key, tab: activeTab \}/,
  );
  // 分区页按 shelf + tab 取数
  assert.match(platformSectionPageSource, /fetchQQMusicNewSongs\(SHELF_PAGE_SIZE, tab\)/);
  assert.match(platformSectionPageSource, /fetchQQMusicNewAlbums\(SHELF_PAGE_SIZE, tab\)/);
  assert.match(platformSectionPageSource, /fetchKugouNewSongs\(SHELF_PAGE_SIZE, tab\)/);
  assert.match(platformSectionPageSource, /fetchKugouHotArtists\(SHELF_PAGE_SIZE, tab\)/);
  assert.match(platformSectionPageSource, /tracks\.map\(trackToAlbumItem\)/);
  assert.match(platformSectionPageSource, /artists\.map\(kgHotArtistToItem\)/);
  // 地区切换后分区页要重新取数
  assert.match(
    platformSectionPageSource,
    /watch\(\[platform, sectionKey, tidalPath, genre, shelfTab\]/,
  );
});

test("榜单分组的筛选标签跟着「榜单」区走，而不是留在页面顶部", () => {
  // 这排标签只作用于榜单区，而榜单区在几排书架之下：留在顶部点了会像没反应
  assert.match(platformHomePageSource, /const rankGroupTabs = computed<GenreItem\[\]>/);
  assert.match(platformHomePageSource, /\{ id: "", name: t\("platformHome\.allRanks"\) \}/);
  assert.match(
    platformHomePageSource,
    /const showGenreRow = computed\(\(\) => genres\.value\.length > 0 && !isRankGroupPlatform\.value\)/,
  );
  // 顶部那行只给 Qobuz/TIDAL（它们的 genre 作用于整页）
  assert.match(platformHomePageSource, /<div v-if="showGenreRow" class="flex flex-wrap gap-1\.5">/);
  // 榜单区里：分组标题 + 筛选标签
  assert.match(
    platformHomePageSource,
    /<div v-if="isGroupStart\(index\)" class="mt-1 flex flex-col gap-2">/,
  );
  assert.match(platformHomePageSource, /v-for="tab in rankGroupTabs"/);
  assert.match(platformHomePageSource, /@click="selectGenre\(tab\.id\)"/);
  assert.match(platformHomePageSource, /group: t\("platformHome\.ranks"\)/);
  // 顶部不再留榜单筛选状态条：标签就在榜单区里，状态就地可见
  assert.doesNotMatch(platformHomePageSource, /rankFiltered/);
});

test("热门歌手卡片按歌手类型跳转，而不是被当成歌单", () => {
  assert.match(platformHomeServiceSource, /export const kgHotArtistToItem/);
  assert.match(codeOnly(platformHomeServiceSource), /kind: "artist"/);
});

test("新增文案中英文齐备", () => {
  for (const locale of [zhLocale, enLocale]) {
    for (const key of ["newSongs", "newAlbums", "hotArtists", "fansCount", "ranks", "allRanks"]) {
      assert.equal(typeof locale.platformHome[key], "string", `缺少 platformHome.${key}`);
    }
    const region = locale.platformHome.region as Record<string, string>;
    for (const key of ["latest", "mainland", "hktw", "western", "korea", "japan", "chinese"]) {
      assert.equal(typeof region[key], "string", `缺少 platformHome.region.${key}`);
    }
  }
  const zh = zhLocale.platformHome as Record<string, string>;
  assert.equal(zh.newAlbums, "新碟首发");
  assert.equal(zh.hotArtists, "热门歌手");
  assert.equal(zh.ranks, "榜单");
});
