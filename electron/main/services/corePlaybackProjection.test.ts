import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

const sharedPlayer = read("shared/types/player.ts");
const session = read("electron/main/services/playbackSession.ts");
const rendererEvents = read("src/core/player/events.ts");

test("Core exposes a loaded-track projection event without persisting resolved URLs in the session", () => {
  assert.match(sharedPlayer, /type: "trackLoaded"/);
  assert.match(sharedPlayer, /track: Track/);
  assert.match(sharedPlayer, /source: string/);
  assert.match(session, /publishTrackLoaded\(item, resolved\.source/);
  const snapshot = sharedPlayer
    .split("export interface PlaybackSessionSnapshot {")[1]
    ?.split("/** 播放器状态快照 */")[0];
  assert.ok(snapshot, "PlaybackSessionSnapshot should exist");
  assert.doesNotMatch(snapshot, /source:/);
});

test("Control projects Core-loaded tracks into media, lyric, cover and history state", () => {
  const section = rendererEvents.split('case "trackLoaded": {')[1]?.split('case "status":')[0];
  assert.ok(section, "trackLoaded projection handler should exist");
  assert.match(section, /media\.setTrack/);
  assert.match(section, /lyricLoader\.loadForTrack/);
  assert.match(section, /coverLoader\.loadCoverForTrack/);
  assert.match(section, /useHistoryStore\(\)\.record/);
  assert.doesNotMatch(section, /window\.api\.player\.load/);
  assert.doesNotMatch(section, /resolveTrackSource/);
});

test("Direct Core boundary publishes the same loaded-track projection contract", () => {
  assert.match(session, /publishTrackLoaded\(prepared\.item, prepared\.directSource/);
});
