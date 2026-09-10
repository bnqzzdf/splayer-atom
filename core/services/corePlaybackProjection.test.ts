import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

const sharedPlayer = read("shared/types/player.ts");
const session = read("core/services/playbackSession.ts");
const rendererEvents = read("src/core/player/events.ts");
const trackInfo = read("src/components/player/TrackInfo.vue");

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

test("successful loads publish a recoverable snapshot before the transient trackLoaded event", () => {
  const loadIndex = session
    .split("const loadIndex = async (")[1]
    ?.split("const loadIndexWithPolicy = async")[0];
  assert.ok(loadIndex, "loadIndex should exist");
  const nowPlayingIndex = loadIndex.indexOf("nowPlaying.update(");
  const publishIndex = loadIndex.indexOf("publish();", nowPlayingIndex);
  const trackLoadedIndex = loadIndex.indexOf("publishTrackLoaded(", publishIndex);
  assert.ok(nowPlayingIndex >= 0, "loadIndex should commit NowPlaying after a successful load");
  assert.ok(publishIndex > nowPlayingIndex, "post-load session must follow NowPlaying commit");
  assert.ok(trackLoadedIndex > publishIndex, "trackLoaded remains the fast transient projection");
});

test("Control reconciles a missed trackLoaded event only against Core loaded state", () => {
  assert.match(rendererEvents, /nowPlayingClient\.getCurrentTrack\(\)/);
  assert.match(rendererEvents, /isSameTrackIdentity\(loaded, expected\)/);
  const section = rendererEvents.split('case "session": {')[1]?.split("break;")[0];
  assert.ok(section, "session projection handler should exist");
  assert.match(section, /reconcileSessionPresentation\(event\.data\)/);
});

test("Control reuses session current as loading presentation without mutating loaded media", () => {
  assert.match(rendererEvents, /status\.trackLoading = session\.active/);
  assert.match(
    trackInfo,
    /trackLoading\.value \? \(status\.currentTrack \?\? media\.track\) : media\.track/,
  );
  assert.match(trackInfo, /player\.preparingAudio/);
  assert.match(trackInfo, /<slot v-if="!trackLoading" name="title-trailing" \/>/);
});

test("Direct Core boundary publishes the same loaded-track projection contract", () => {
  assert.match(session, /publishTrackLoaded\(prepared\.item, prepared\.directSource/);
});
