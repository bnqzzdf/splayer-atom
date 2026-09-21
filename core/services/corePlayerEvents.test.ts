import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const coreEntryPath = resolve(process.cwd(), "core/core-node/index.ts");
const coreEventsPath = resolve(process.cwd(), "core/services/corePlayerEvents.ts");
const nativeBackgroundPath = resolve(
  process.cwd(),
  "native/audio-engine-core/src/player/background.rs",
);

test("Node Core registers native player events before the playback session creates the player", () => {
  const source = readFileSync(coreEntryPath, "utf8");
  const registerIndex = source.indexOf("corePlayerEvents.registerCorePlayerEvents();");
  const sessionIndex = source.indexOf("playbackSession.initPlaybackSession()");

  assert.ok(registerIndex >= 0, "Core native event registration should exist");
  assert.ok(sessionIndex >= 0, "Core playback session initialization should exist");
  assert.ok(
    registerIndex < sessionIndex,
    "native events must be registered before first player creation",
  );
});

test("Core native player event router stays Electron-free and owns session lifecycle events", () => {
  const source = readFileSync(coreEventsPath, "utf8");

  assert.doesNotMatch(source, /from ["']electron["']/);
  assert.match(source, /playbackSession\.onNativePosition\(enginePositionMs\)/);
  assert.match(source, /playbackSession\.onNativeEnded\(\)/);
  assert.match(source, /playbackSession\.onNativeSourceError\(\)/);
  assert.match(source, /player\.markOutputUnavailable\(\)/);
  assert.doesNotMatch(source, /requestReinit|reinitOutput/);
});

test("output failure is never routed into source recovery or automatic rebuild", () => {
  const source = readFileSync(coreEventsPath, "utf8");
  const outputFailure = source.split('case "outputFailed":')[1]?.split('case "fftData":')[0] ?? "";
  assert.match(outputFailure, /markOutputUnavailable/);
  assert.doesNotMatch(outputFailure, /onNativeSourceError|requestReinit|reinitOutput/);
});

test("Direct monitor routes source and output failures through different events", () => {
  const source = readFileSync(nativeBackgroundPath, "utf8");
  const directTimer = source.split("if let Some((monitor, seek_base")[1]?.split("let shared =")[0] ?? "";
  assert.match(directTimer, /DirectFailureKind::Source => cb\(PlayerEvent::SourceError\)/);
  assert.match(directTimer, /DirectFailureKind::Output => cb\(PlayerEvent::OutputFailed\)/);
});
