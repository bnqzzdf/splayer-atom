import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const playerIpcPath = resolve(process.cwd(), "electron/main/ipc/player.ts");

test("Electron shutdown explicitly releases the native Direct runtime", () => {
  const source = readFileSync(playerIpcPath, "utf8");
  const shutdown = source
    .split('app.on("before-quit", () => {')
    .at(-1)
    ?.split("});")[0];

  assert.ok(shutdown, "player before-quit handler should exist");
  assert.match(shutdown, /resetPlayer\(\);/);
  assert.match(shutdown, /cleanupDirectInputs\(\)/);
});
