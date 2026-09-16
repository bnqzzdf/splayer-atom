import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const eventsSource = readFileSync(new URL("./events.ts", import.meta.url), "utf8");
const preloaderSource = readFileSync(
  new URL("../../services/nextTrackPreloader.ts", import.meta.url),
  "utf8",
);
const audioSource = readFileSync(new URL("../../services/audioSource.ts", import.meta.url), "utf8");
const sharedPlayerSource = readFileSync(
  new URL("../../../shared/types/player.ts", import.meta.url),
  "utf8",
);
const headlessRoutesSource = readFileSync(
  new URL("../../../core/atom/headless/routes.ts", import.meta.url),
  "utf8",
);
const directGaplessServiceSource = readFileSync(
  new URL("../../../core/services/directGapless.ts", import.meta.url),
  "utf8",
);
const corePreloaderSource = readFileSync(
  new URL("../../../core/services/playbackPreloader.ts", import.meta.url),
  "utf8",
);
const sessionSource = readFileSync(
  new URL("../../../core/services/playbackSession.ts", import.meta.url),
  "utf8",
);

const between = (source: string, start: string, end: string): string => {
  const afterStart = source.split(start)[1];
  assert.ok(afterStart, `missing start marker: ${start}`);
  const section = afterStart.split(end)[0];
  assert.ok(section, `missing end marker: ${end}`);
  return section;
};

test("Direct gapless boundary is committed exclusively by Core", () => {
  const coreBoundary = between(
    sessionSource,
    "export const onNativeDirectTrackBoundary = (",
    "const consumeAutoCloseOnEnded",
  );
  assert.match(coreBoundary, /consumeDirectPlaybackBoundary\(generation, queue\)/);
  assert.match(coreBoundary, /commitDirectPlaybackBoundary\(/);
  assert.match(coreBoundary, /publishTrackLoaded\(/);
  assert.match(coreBoundary, /scheduleNextPlaybackPreload\(\)/);

  assert.doesNotMatch(eventsSource, /directTrackBoundary|sourceError/);
  assert.doesNotMatch(eventsSource, /commitDirectGaplessTrack|commitDirectGaplessBoundary/);
});

test("Direct staging respects Core playback semantics before handing audio to native", () => {
  assert.match(preloaderSource, /renderer 只利用 Chromium 预热下一首歌词与封面/);
  assert.doesNotMatch(
    preloaderSource,
    /stageDirectNext|cancelDirectNext|directGeneration|materializeDirectInput/,
  );
  assert.match(
    corePreloaderSource,
    /store\.get\("player\.outputDevice"\)\?\.startsWith\("diretta:"\)/,
  );
  assert.doesNotMatch(corePreloaderSource, /getSelectedDeviceName\(\)/);
  assert.match(corePreloaderSource, /directCueSegmentFromTrack\(track\)/);
  assert.match(
    corePreloaderSource,
    /track\.cueStartMs != null && track\.cueEndMs != null && !segment/,
  );
  assert.match(
    corePreloaderSource,
    /stageDirectPlaybackNext\([\s\S]*segment\?\.startFrame75,[\s\S]*segment\?\.endFrame75/,
  );
  assert.match(sessionSource, /autoClose\.enabled && autoClose\.waitSongEnd/);
  assert.match(sessionSource, /nextPlaybackPreloadIndex/);
});

test("Full Direct loads wait for background preload cleanup while queue invalidation cancels immediately", () => {
  assert.match(
    corePreloaderSource,
    /export const waitForPlaybackPreloadIdle = \(\): Promise<void> => directStageChain/,
  );
  assert.match(corePreloaderSource, /const cancelDirectStageNow = \(\): void =>/);
  assert.match(
    corePreloaderSource,
    /const clearPrepared = [\s\S]*if \(cleanupDirect\) \{\s*cancelDirectStageNow\(\);/,
  );
  const cleanupFlow = between(
    corePreloaderSource,
    "const queueDirectCleanup =",
    "const clearPrepared =",
  );
  assert.doesNotMatch(cleanupFlow, /cancelDirectPlaybackNext\(\)/);
  const coreLoad = between(sessionSource, "const loadIndex = async (", "const loadIndexWithPolicy");
  const idleIndex = coreLoad.indexOf("await waitForPlaybackPreloadIdle()");
  const nativeLoadIndex = coreLoad.indexOf("await loadPlayerSource(");
  assert.ok(idleIndex >= 0);
  assert.ok(nativeLoadIndex > idleIndex);
});

test("Core Direct boundary prunes superseded temporary online inputs", () => {
  assert.match(sessionSource, /commitDirectPlaybackBoundary\(prepared\.directSource/);
  assert.match(directGaplessServiceSource, /commitDirectGaplessBoundary/);
  assert.match(directGaplessServiceSource, /pruneDirectInputs\(source\)/);
});

test("renderer-facing Direct staging and materialization protocol is removed end to end", () => {
  const forbidden =
    /stageDirectNext|cancelDirectNext|commitDirectGaplessBoundary|materializeDirectInput/;
  assert.doesNotMatch(sharedPlayerSource, forbidden);
  assert.doesNotMatch(headlessRoutesSource, /\/player\/direct-input\/materialize/);
  assert.doesNotMatch(
    audioSource,
    /prepareDirectTrackSource|window\.api\.player\.materializeDirectInput/,
  );
});
