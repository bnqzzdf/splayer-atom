import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

const platformHomeSource = read("../../src/pages/PlatformHome.vue");
const zhLocale = JSON.parse(read("../../src/i18n/locales/zh-CN.json")) as {
  platformHome: Record<string, unknown>;
};
const enLocale = JSON.parse(read("../../src/i18n/locales/en-US.json")) as {
  platformHome: Record<string, unknown>;
};

test("TIDAL 分区标题走中文化映射，而不是直接透出英文", () => {
  assert.match(
    platformHomeSource,
    /const tidalSectionTitle = \(rawTitle: string \| undefined, type: string\): string =>/,
  );
  // 实际取标题处必须经过映射
  assert.match(
    platformHomeSource,
    /title: tidalSectionTitle\(str\(moduleRecord\.title\) \?\? str\(rowRecord\.title\), type\)/,
  );
  assert.doesNotMatch(
    platformHomeSource,
    /title: str\(moduleRecord\.title\) \?\? str\(rowRecord\.title\) \?\? tidalModuleTitle\(type\)/,
  );
});

test("TIDAL 已见分区标题全部有中文映射", () => {
  // 实测 pages/home 返回的五个分区标题（en 默认）
  for (const title of [
    "The Hits",
    "New Tracks",
    "New Albums",
    "Spotlighted Uploads",
    "From our editors",
  ]) {
    assert.ok(platformHomeSource.includes(`"${title}": t(`), `缺少分区标题映射: ${title}`);
  }
});

test("只做完全匹配：未知标题原样透出，不被错误翻译", () => {
  // 关键安全性：TIDAL 会按 locale 返回德语/法语标题（Die Hits / Les hits），
  // 也会新增分区；这些必须原样显示，而不是落到 type 兜底或错译。
  assert.match(
    platformHomeSource,
    /if \(rawTitle && known\[rawTitle\]\) return known\[rawTitle\];/,
  );
  assert.match(platformHomeSource, /return rawTitle \?\? tidalModuleTitle\(type\);/);
});

test("中英文两份文案都齐备，且英文侧保留 TIDAL 原文", () => {
  for (const locale of [zhLocale, enLocale]) {
    const section = locale.platformHome.tidalSection as Record<string, string>;
    assert.ok(section, "缺少 platformHome.tidalSection");
    for (const key of ["hits", "newTracks", "newAlbums", "spotlightedUploads", "fromOurEditors"]) {
      assert.ok(section[key], `缺少 tidalSection.${key}`);
    }
  }
  const zh = zhLocale.platformHome.tidalSection as Record<string, string>;
  const en = enLocale.platformHome.tidalSection as Record<string, string>;
  // 中文侧不得残留英文原文
  assert.equal(zh.hits, "热门精选");
  assert.equal(zh.newTracks, "新歌");
  assert.equal(zh.newAlbums, "新专辑");
  // 英文侧应与 TIDAL 原文一致，避免英文界面出现中文
  assert.equal(en.hits, "The Hits");
  assert.equal(en.newTracks, "New Tracks");
  assert.equal(en.newAlbums, "New Albums");
});
