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
