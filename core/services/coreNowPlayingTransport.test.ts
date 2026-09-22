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

test("lyric offset is Core-persisted but explicitly scoped by lyric source", () => {
  assert.match(nowPlayingService, /publishCoreControlEvent\(\{ type: "lyricOffset", data \}\)/);
  assert.match(playerControl, /subscribeCoreControlEvent\(\s*"lyricOffset"/);
  assert.match(mediaStore, /nowPlayingClient\s*\.getLyricOffset\(currentTrackId, source\)/);
  assert.match(
    lyricActions,
    /nowPlayingClient\.setLyricOffset\(id, media\.activeLyric, offsetMs\)/,
  );
  assert.match(nowPlayingClient, /"\/now-playing\/lyric-offset\/query"/);
  assert.match(nowPlayingClient, /JSON\.stringify\(\{ trackId, source, offsetMs \}\)/);
});

test("renderer lyric presentation stays inside each Web Control", () => {
  assert.doesNotMatch(nowPlayingTypes, /NowPlayingUpdatePayload|LyricLine\[\]/);
  assert.doesNotMatch(mediaStore, /updateLyrics|syncToMain/);
  assert.doesNotMatch(headlessRoutes, /api\.post\("\/now-playing",/);
  assert.doesNotMatch(headlessRoutes, /api\.get\("\/lyrics"/);
  assert.doesNotMatch(nowPlayingService, /currentLyric|currentSource|updateLyrics|lyricSnapshot/);
  assert.match(nowPlayingTypes, /detail: TrackDetail \| null/);
  assert.match(nowPlayingClient, /getCurrentPlayback/);
});
