import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

const nowPlayingService = read("core/services/nowPlaying.ts");
const playerControl = read("src/core/player/index.ts");
const lyricActions = read("src/components/player/FullPlayer/LyricActions.vue");
const nowPlayingClient = read("src/core/nowPlayingClient.ts");
const mediaStore = read("src/stores/media.ts");
const nowPlayingTypes = read("shared/types/nowPlaying.ts");
const headlessRoutes = read("core/atom/headless/routes.ts");

test("lyric offset snapshot command and event use the shared Core transport", () => {
  assert.match(nowPlayingService, /publishCoreControlEvent\(\{ type: "lyricOffset", data \}\)/);
  assert.match(playerControl, /subscribeCoreControlEvent\("lyricOffset"/);
  assert.match(playerControl, /nowPlayingClient\.getLyricOffset\(\)/);
  assert.doesNotMatch(playerControl, /window\.api\.nowPlaying\.onLyricOffsetChange/);
  assert.doesNotMatch(playerControl, /window\.api\.nowPlaying\.requestSnapshot/);
  assert.match(lyricActions, /nowPlayingClient\.setLyricOffset\(id, offsetMs\)/);
  assert.doesNotMatch(lyricActions, /window\.api\.nowPlaying\.setLyricOffset/);
  assert.match(nowPlayingClient, /request<LightNowPlayingSnapshot>\("\/now-playing"\)/);
  assert.match(nowPlayingClient, /"\/now-playing\/lyric-offset"/);
});

test("temporary renderer lyric enrichment cannot replace the Core current Track", () => {
  const updatePayload = nowPlayingTypes
    .split("export interface NowPlayingUpdatePayload {")[1]
    ?.split("}")[0];
  assert.ok(updatePayload);
  assert.doesNotMatch(updatePayload, /track:/);
  assert.match(mediaStore, /nowPlayingClient\.updateLyrics\(payload\)/);
  const syncSection = mediaStore.split("const syncToMain = (): void => {")[1]?.split("};")[0];
  assert.ok(syncSection);
  assert.doesNotMatch(syncSection, /track:/);
  const routeSection = headlessRoutes
    .split('api.post("/now-playing", async (c) => {')[1]
    ?.split('api.post("/now-playing/lyric-offset"')[0];
  assert.ok(routeSection);
  assert.match(routeSection, /nowPlaying\.updateLyrics\(/);
  assert.doesNotMatch(routeSection, /track\?:|nowPlaying\.update\(/);
});
