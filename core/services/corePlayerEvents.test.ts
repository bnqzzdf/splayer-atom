import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const coreEntryPath = resolve(process.cwd(), "core/core-node/index.ts");
const coreEventsPath = resolve(process.cwd(), "core/services/corePlayerEvents.ts");

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
  assert.match(source, /requestReinit\(player\)/);
});
