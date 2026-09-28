import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const qmModulesSource = read("core/apis/qqmusic/modules/index.ts");
const qmNewSongSource = read("core/apis/qqmusic/modules/newsong.ts");
const qmNewAlbumSource = read("core/apis/qqmusic/modules/newalbum.ts");
const kgModulesSource = read("core/apis/kugou/modules/index.ts");
const kgHotArtistSource = read("core/apis/kugou/modules/hot_artist.ts");
const qmPlaylistApiSource = read("src/apis/playlist/qqmusic.ts");
const kgPlaylistApiSource = read("src/apis/playlist/kugou.ts");
const platformHomePageSource = read("src/pages/PlatformHome.vue");
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
  // 标签由「已登录平台」按同一顺序过滤而来
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
  assert.match(qmModulesSource, /new_songs: newSong/);
  assert.match(qmPlaylistApiSource, /qmApi\.new_songs</);
  assert.match(platformHomePageSource, /newSongSection\("qm-new-songs"/);
});

test("QM 新碟首发的参数名必须是 albumType", () => {
  assert.match(qmNewAlbumSource, /"newalbum\.NewAlbumServer"/);
  assert.match(qmNewAlbumSource, /"get_new_album_info"/);
  assert.match(qmNewAlbumSource, /albumType/);
  // 实测：传 type 回 code=10006、传空对象回 code=2000 且 albums 为空，
  // 两者都不抛异常，极易被当成"没有新碟"，所以请求里不能出现裸 type 字段
  assert.match(qmNewAlbumSource, /\{ albumType, num, page \}/);
  assert.match(qmModulesSource, /new_albums: newAlbum/);
  assert.match(qmPlaylistApiSource, /qmApi\.new_albums</);
  assert.match(platformHomePageSource, /qmNewAlbumSection\(newAlbums\)/);
});

test("KG 热门歌手读 data.info（没有 data.list 这个键）", () => {
  assert.match(kgHotArtistSource, /api\/v5\/singer\/list\?sort=1/);
  // 注释里会解释"为什么不用 v3 / 为什么不是 list"，所以负向断言只看代码行
  const code = kgHotArtistSource
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  // v3 的 singer/rank、singer/list 在该通道一律 Access Deny
  assert.doesNotMatch(code, /api\/v3\/singer/);
  // 按 list 取会拿到空数组（条目实际在 info 里）
  assert.doesNotMatch(code, /data\.list/);
  assert.match(kgHotArtistSource, /const data = body\.data \?\? \{\}/);
  assert.match(kgHotArtistSource, /\(data\.info \?\? \[\]\)/);
  // singerid 与榜单 authors[].author_id 同一 id 空间，可直接进歌手详情
  assert.match(kgHotArtistSource, /singerid/);
  assert.match(kgModulesSource, /hot_artists: hotArtist/);
  assert.match(kgPlaylistApiSource, /kgApi\.hot_artists</);
  assert.match(platformHomePageSource, /kgHotArtistSection\(hotArtists\)/);
});

test("热门歌手卡片按歌手类型跳转，而不是被当成歌单", () => {
  // kind 决定点击目标；歌手卡片必须走 artist 分支
  assert.match(platformHomePageSource, /kind: "artist" as const/);
});

test("三个新分区的标题中英文齐备", () => {
  for (const locale of [zhLocale, enLocale]) {
    for (const key of ["newSongs", "newAlbums", "hotArtists", "fansCount"]) {
      assert.equal(typeof locale.platformHome[key], "string", `缺少 platformHome.${key}`);
    }
  }
  const zh = zhLocale.platformHome as Record<string, string>;
  assert.equal(zh.newAlbums, "新碟首发");
  assert.equal(zh.hotArtists, "热门歌手");
});
