import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const coreEntry = readFileSync(new URL("../core-node/index.ts", import.meta.url), "utf8");

test("Core shutdown flushes durable settings and exits without graceful runtime teardown", () => {
  const shutdown = coreEntry.split("const shutdown = (signal")[1]?.split("process.once")[0];
  assert.ok(shutdown, "Core shutdown handler should exist");
  assert.match(shutdown, /store\.flushImmediate\(\)/);
  assert.match(shutdown, /process\.exit\(exitCode\)/);
  assert.ok(
    shutdown.indexOf("flushImmediate") < shutdown.indexOf("process.exit"),
    "durable settings must flush before process exit",
  );
  for (const forbidden of [
    "await ",
    "shutdownPlaybackSession",
    "songCache.shutdown",
    "downloadManager.shutdown",
    "shutdownCorePlayStats",
    "shutdownListenBrainz",
    "unregisterPluginControlEvents",
    "pluginRegistry.shutdown",
    "server.stopServer",
    "database.closeDatabase",
  ]) {
    assert.doesNotMatch(shutdown, new RegExp(forbidden.replace(".", "\\.")));
  }
});
