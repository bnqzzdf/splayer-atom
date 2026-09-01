import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

const preloader = read("electron/main/services/playbackPreloader.ts");
const session = read("electron/main/services/playbackSession.ts");
const coreEvents = read("electron/main/services/corePlayerEvents.ts");
const webEvents = read("src/core/player/events.ts");
const playerControl = read("src/core/player/index.ts");

test("Core preload prepares Diretta input and stages through the shared main service", () => {
  assert.match(preloader, /stageDirectPlaybackNext/);
  assert.match(preloader, /materializeDirectInput/);
  assert.match(preloader, /resolved\.cacheAfterLoad \? await resolved\.cacheAfterLoad\(\) : null/);
  assert.match(preloader, /getSelectedDeviceName\(\)\?\.startsWith\("diretta:"\)/);
  assert.doesNotMatch(preloader, /window\.api/);
});

test("Diretta staging remains active when generic next-track preload is disabled", () => {
  assert.match(
    preloader,
    /store\.get\("player\.preloadNextTrack"\) === true \|\|[\s\S]*getSelectedDeviceName\(\)\?\.startsWith\("diretta:"\) === true/,
  );
  assert.equal(preloader.match(/if \(!shouldPrepareNextInput\(\)\)/g)?.length, 2);
});

test("manual preload consumption cancels staging without deleting the source that normal load will use", () => {
  assert.match(preloader, /queueDirectCleanup\(prepared\.directSource, false\)/);
});

test("Node Core consumes Direct boundary into the authoritative session", () => {
  assert.match(coreEvents, /playbackSession\.onNativeDirectTrackBoundary\(generation, duration\)/);
  assert.match(session, /consumeDirectPlaybackBoundary\(generation, queue\)/);
  assert.match(session, /commitDirectPlaybackBoundary/);
  assert.match(session, /scheduleNextPlaybackPreload\(\)/);
});

test("Direct recovery fallback stays Desktop-only after Web leaves legacy player events", () => {
  const boundary = webEvents
    .split('case "directTrackBoundary": {')[1]
    ?.split('case "sourceError":')[0];
  assert.ok(boundary, "directTrackBoundary handler should exist");
  assert.doesNotMatch(webEvents, /isWebRemote\(\)/);
  assert.equal(playerControl.match(/window\.api\.player\.onEvent\(handleEvent\)/g)?.length, 1);
  assert.ok(
    playerControl.indexOf("window.api.player.onEvent(handleEvent)") >
      playerControl.indexOf("if (webRemote) {"),
  );
});
