import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

const nowPlayingService = read("electron/main/services/nowPlaying.ts");
const nowPlayingIpc = read("electron/main/ipc/nowPlaying.ts");
const playerControl = read("src/core/player/index.ts");
const lyricActions = read("src/components/player/FullPlayer/LyricActions.vue");
const webApi = read("src/web/api.ts");

test("lyric offset snapshot command and event use the shared Core transport", () => {
  assert.match(nowPlayingService, /publishCoreControlEvent\(\{ type: "lyricOffset", data \}\)/);
  assert.doesNotMatch(nowPlayingIpc, /wsBroadcast\(\{ type: "lyricOffset"/);
  assert.match(playerControl, /subscribeCoreControlEvent\("lyricOffset"/);
  assert.match(playerControl, /nowPlayingClient\.getLyricOffset\(\)/);
  assert.doesNotMatch(playerControl, /window\.api\.nowPlaying\.onLyricOffsetChange/);
  assert.doesNotMatch(playerControl, /window\.api\.nowPlaying\.requestSnapshot/);
  assert.match(lyricActions, /nowPlayingClient\.setLyricOffset\(id, offsetMs\)/);
  assert.doesNotMatch(lyricActions, /window\.api\.nowPlaying\.setLyricOffset/);
  assert.match(webApi, /requestSnapshot: nowPlayingClient\.requestSnapshot/);
  assert.match(webApi, /setLyricOffset: nowPlayingClient\.setLyricOffset/);
  assert.match(webApi, /subscribeCoreControlEvent\("lyricOffset", callback\)/);
});

test("renderer update remains an explicit temporary lyrics authority seam", () => {
  assert.match(read("src/stores/media.ts"), /window\.api\.nowPlaying\.update\(payload\)/);
  assert.match(nowPlayingIpc, /ipcMain\.on\("nowPlaying:update"/);
});
