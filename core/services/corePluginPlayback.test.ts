import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Track } from "@shared/types/player";
import {
  buildPluginPlaybackMusicInfo,
  pluginPlaybackSource,
} from "../../shared/utils/pluginPlayback";

const resolverSource = readFileSync(
  new URL("./playbackSourceResolver.ts", import.meta.url),
  "utf8",
);

test("inherited plugin source mapping stays limited to upstream-compatible platforms", () => {
  assert.equal(pluginPlaybackSource("netease"), "wy");
  assert.equal(pluginPlaybackSource("qqmusic"), "tx");
  assert.equal(pluginPlaybackSource("kugou"), "kg");
  assert.equal(pluginPlaybackSource("qobuz"), null);
  assert.equal(pluginPlaybackSource("tidal"), null);
  assert.equal(pluginPlaybackSource("streaming"), null);
});

test("Core plugin fallback uses the shared musicUrl compatibility payload", () => {
  const track: Track = {
    id: "0123456789abcdef0123456789abcdef",
    source: "kugou",
    title: "Compat Track",
    artists: [
      { id: "a", name: "Artist A" },
      { id: "b", name: "Artist B" },
    ],
    album: { id: "album", name: "Album" },
    duration: 185_000,
    cover: "https://img.example/cover.jpg",
  };
  const info = buildPluginPlaybackMusicInfo(track, "kg");
  assert.equal(info.id, track.id);
  assert.equal(info.songmid, track.id);
  assert.equal(info.songId, track.id);
  assert.equal(info.singer, "Artist A/Artist B");
  assert.equal(info.interval, "03:05");
  assert.equal(info.hash, track.id);
  assert.equal(info.albumId, "album");
  assert.equal((info.meta as { picUrl?: string | null })?.picUrl, track.cover);
  assert.match(resolverSource, /buildPluginPlaybackMusicInfo\(track, pluginSource\)/);
});

test("Core preserves official-first Netease fallback and inherited QQ/Kugou compatibility", () => {
  assert.match(resolverSource, /resolveNeteaseWithPluginFallback/);
  const fallback = resolverSource.split("const resolveNeteaseWithPluginFallback = async (")[1];
  assert.ok(fallback);
  const section = fallback.split("const resolveQobuz = async (")[0];
  assert.ok(section);
  const officialIndex = section.indexOf("resolveNetease(track, quality, cacheKey)");
  const pluginIndex = section.indexOf("resolvePluginCompatibility(track, quality, cacheKey)");
  const trialIndex = section.indexOf("if (trial) return trial");
  assert.ok(officialIndex >= 0 && pluginIndex > officialIndex && trialIndex > pluginIndex);
  assert.match(resolverSource, /track\.source === "qqmusic" \|\| track\.source === "kugou"/);
});

test("Qobuz and TIDAL remain Atom official-provider paths without new plugin ownership", () => {
  const dispatch = resolverSource.split("export const resolvePlaybackSource = async")[1];
  assert.ok(dispatch);
  assert.match(dispatch, /track\.source === "qobuz"\) return resolveQobuz/);
  assert.match(dispatch, /track\.source === "tidal"\) return resolveTidal/);
  assert.doesNotMatch(dispatch, /pluginPlaybackSource\("qobuz"\)|pluginPlaybackSource\("tidal"\)/);
});

test("plugin source failures keep the entitlement reason instead of collapsing to URL_RESOLVE_FAILED", () => {
  const section = resolverSource
    .split("const resolvePluginCompatibility = async (")[1]
    ?.split("const resolveNetease = async (")[0];
  assert.ok(section, "plugin compatibility resolver should exist");

  // 结构化 reason 优先，其次按文案归类，最后才退回通用失败码。
  assert.match(section, /pluginUnavailableErrorCode\(resolved\.reason\)/);
  assert.match(section, /classifyPluginFailureMessage\(message\)/);
  assert.match(
    section,
    /const code = structuredCode \?\? messageCode \?\? ErrorCode\.URL_RESOLVE_FAILED/,
  );
  assert.match(section, /resolved\.trial === true && !allowTrial/);
  assert.match(section, /ErrorCode\.PROVIDER_TRIAL_DISABLED/);
  // provider 字段要能区分试听与正常插件音源。
  assert.match(section, /provider: resolved\.trial === true \? "trial" : "plugin"/);
});

test("QM/KG 先用 Core 原生 song_url 解析，插件只作兜底", () => {
  const inherited = resolverSource
    .split("const resolveInheritedOnline = async (")[1]
    ?.split("const resolveNetease = async (")[0];
  assert.ok(inherited, "resolveInheritedOnline 应当存在");

  // 原生优先：先 resolveQQMusic / resolveKugou，两者都失败才轮到插件
  assert.match(inherited, /track\.source === "qqmusic"\s*\? await resolveQQMusic/);
  assert.match(inherited, /await resolveKugou\(track, quality, cacheKey\)/);
  const nativeIdx = inherited.indexOf("await resolveKugou(track, quality, cacheKey)");
  const pluginIdx = inherited.indexOf("await resolvePluginCompatibility(track, quality, cacheKey)");
  assert.ok(nativeIdx >= 0 && pluginIdx > nativeIdx, "插件兜底必须在原生之后");

  // 原生给出的权益原因优先于插件的「找不到插件」
  assert.match(inherited, /INFORMATIVE_SOURCE_ERRORS\.has\(nativeCode\)/);
  assert.match(resolverSource, /ErrorCode\.PROVIDER_LOGIN_REQUIRED/);
});

test("KG 免费段按试听处理，而不是当整曲", () => {
  const kugou = resolverSource
    .split("const resolveKugou = async (")[1]
    ?.split("const resolveInheritedOnline")[0];
  assert.ok(kugou, "resolveKugou 应当存在");
  // 先按权益取整曲，取不到再退到 freePart
  const first = kugou.indexOf('callKugou("song_url", params)');
  const free = kugou.indexOf("freePart: true");
  assert.ok(first >= 0 && free > first, "freePart 必须只作为第二步回退");
  // 免费段实测只有约 1MB（约 24 秒），必须按 trial 处理并遵守 allowTrialPlay
  assert.match(kugou, /provider: trial \? "trial" : "official"/);
  assert.match(kugou, /ErrorCode\.PROVIDER_TRIAL_DISABLED/);
  assert.match(kugou, /store\.get\("player\.allowTrialPlay"\)/);
});

test("QM 未登录时给「需要登录」而不是「需要会员」", () => {
  const qm = resolverSource
    .split("const resolveQQMusic = async (")[1]
    ?.split("const resolveKugou = async (")[0];
  assert.ok(qm, "resolveQQMusic 应当存在");
  assert.match(qm, /getProviderSessions\(\)\.qqmusic\.authenticated/);
  assert.match(qm, /ErrorCode\.PROVIDER_LOGIN_REQUIRED/);
});
