import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (file: string): string => readFileSync(resolve(process.cwd(), file), "utf8");
const session = read("electron/main/services/playbackSession.ts");
const preloader = read("electron/main/services/playbackPreloader.ts");
const directGapless = read("electron/main/services/directGapless.ts");
const sacdInput = read("electron/main/atom/sacdInput.ts");
const nativePlayer = read("native/audio-engine/src/bindings/player.rs");

test("native outputs materialize SACD virtual tracks before AudioPlayer load", () => {
  assert.match(sacdInput, /parseSacdPlaybackSource/);
  assert.match(sacdInput, /getEngine\(\)\.extractSacdDsf/);
  assert.match(session, /parseSacdPlaybackSource\(resolved\.source, track\.track\)/);
  assert.match(session, /await prepareSacdPlaybackInput\(sacd\)/);
  assert.match(session, /loadPlayerSource\(\s*nativeResolved\.source/);
  assert.match(session, /pruneSacdPlaybackInputs\(managedSacdInput \?\? ""\)/);
  assert.doesNotMatch(nativePlayer, /parseSacdPlaybackSource|SacdTrackReader|extractSacdDsf/);
});

test("Diretta preload stages the same generated SACD DSF and keeps it through boundary", () => {
  assert.match(preloader, /parseSacdPlaybackSource\(directSource, track\.track\)/);
  assert.match(preloader, /await prepareSacdPlaybackInput\(sacd\)/);
  assert.match(preloader, /stageDirectPlaybackNext\(directSource/);
  assert.match(preloader, /discardSacdPlaybackInput/);
  assert.match(directGapless, /pruneSacdPlaybackInputs\(source\)/);
});

test("terminal native SACD commands invalidate an in-flight Direct preload", () => {
  assert.match(
    session,
    /export const stop = \(\): void => \{[\s\S]*?invalidatePlaybackPreload\(\);[\s\S]*?pruneSacdPlaybackInputs\(""\)/,
  );
  assert.match(
    session,
    /export const shutdownPlaybackSession = async \(\): Promise<void> => \{[\s\S]*?invalidatePlaybackPreload\(\);[\s\S]*?cleanupSacdPlaybackInputs\(\)/,
  );
});
