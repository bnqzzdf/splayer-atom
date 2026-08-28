import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

const preloader = read("electron/main/services/playbackPreloader.ts");
const session = read("electron/main/services/playbackSession.ts");
const coreEvents = read("electron/main/services/corePlayerEvents.ts");
const webEvents = read("src/core/player/events.ts");

test("Core preload prepares Diretta input and stages through the shared main service", () => {
  assert.match(preloader, /stageDirectPlaybackNext/);
  assert.match(preloader, /materializeDirectInput/);
  assert.match(preloader, /resolved\.cacheAfterLoad \? await resolved\.cacheAfterLoad\(\) : null/);
  assert.match(preloader, /getSelectedDeviceName\(\)\?\.startsWith\("diretta:"\)/);
  assert.doesNotMatch(preloader, /window\.api/);
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

test("remote Web never owns a Core-consumed Direct boundary", () => {
  const boundary = webEvents.split('case "directTrackBoundary": {')[1]?.split('case "sourceError":')[0];
  assert.ok(boundary, "directTrackBoundary handler should exist");
  assert.match(boundary, /if \(isWebRemote\(\)\) break/);
});
