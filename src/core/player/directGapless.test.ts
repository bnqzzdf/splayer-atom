import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const eventsSource = readFileSync(new URL("./events.ts", import.meta.url), "utf8");
const playerSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const preloaderSource = readFileSync(
  new URL("../../services/nextTrackPreloader.ts", import.meta.url),
  "utf8",
);
const mainPlayerSource = readFileSync(
  new URL("../../../electron/main/ipc/player.ts", import.meta.url),
  "utf8",
);
const directGaplessServiceSource = readFileSync(
  new URL("../../../electron/main/services/directGapless.ts", import.meta.url),
  "utf8",
);
const corePreloaderSource = readFileSync(
  new URL("../../../electron/main/services/playbackPreloader.ts", import.meta.url),
  "utf8",
);
const sessionSource = readFileSync(
  new URL("../../../electron/main/services/playbackSession.ts", import.meta.url),
  "utf8",
);

const between = (source: string, start: string, end: string): string => {
  const afterStart = source.split(start)[1];
  assert.ok(afterStart, `missing start marker: ${start}`);
  const section = afterStart.split(end)[0];
  assert.ok(section, `missing end marker: ${end}`);
  return section;
};

test("Direct gapless boundary commits application state without reloading audio", () => {
  const boundary = between(eventsSource, 'case "directTrackBoundary": {', 'case "sourceError":');
  assert.match(boundary, /commitDirectGaplessTrack/);
  assert.doesNotMatch(boundary, /window\.api\.player\.load/);
  assert.doesNotMatch(boundary, /loadTrack\(/);

  const commit = between(
    playerSource,
    "export const commitDirectGaplessTrack = async (",
    "/**\n * 热替换当前播放",
  );
  assert.match(commit, /commitDirectGaplessBoundary/);
  assert.doesNotMatch(commit, /window\.api\.player\.load/);
  assert.doesNotMatch(commit, /loadTrack\(/);
  assert.doesNotMatch(commit, /window\.api\.player\.stop/);
});

test("Direct staging respects Core playback semantics before handing audio to native", () => {
  assert.doesNotMatch(preloaderSource, /stageDirectNext|outputDevice\?\.startsWith\("diretta:"\)/);
  assert.match(corePreloaderSource, /getSelectedDeviceName\(\)\?\.startsWith\("diretta:"\)/);
  assert.match(corePreloaderSource, /track\.cueStartMs != null \|\| track\.cueEndMs != null/);
  assert.match(corePreloaderSource, /stageDirectPlaybackNext/);
  assert.match(sessionSource, /autoClose\.enabled && autoClose\.waitSongEnd/);
  assert.match(sessionSource, /nextPlaybackPreloadIndex/);
});

test("Direct gapless boundary prunes superseded temporary online inputs", () => {
  const commit = between(mainPlayerSource, '"player:commitDirectGaplessBoundary",', "// 设置音量");
  assert.match(commit, /commitDirectPlaybackBoundary/);
  assert.match(directGaplessServiceSource, /commitDirectGaplessBoundary/);
  assert.match(directGaplessServiceSource, /pruneDirectInputs\(source\)/);
});
