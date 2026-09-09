import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const coreEntry = readFileSync(new URL("../core-node/index.ts", import.meta.url), "utf8");
const session = readFileSync(new URL("../services/playbackSession.ts", import.meta.url), "utf8");

test("Core shutdown invalidates playback staging before stopping services", () => {
  const shutdown = coreEntry.split("const shutdown = async")[1]?.split("process.once")[0];
  assert.ok(shutdown, "Core shutdown handler should exist");
  assert.match(shutdown, /await playbackSession\.shutdownPlaybackSession\(\)/);
  assert.match(shutdown, /await server\.stopServer\(\)/);
  assert.ok(
    shutdown.indexOf("shutdownPlaybackSession") < shutdown.indexOf("stopServer"),
    "playback session must be released before server shutdown",
  );
  const sessionShutdown = session.split("export const shutdownPlaybackSession")[1]?.split("};")[0];
  assert.ok(sessionShutdown);
  assert.match(sessionShutdown, /\+\+loadGeneration/);
  assert.match(sessionShutdown, /invalidatePlaybackPreload\(\)/);
});
