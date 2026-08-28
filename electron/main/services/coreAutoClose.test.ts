import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sessionSource = readFileSync(new URL("./playbackSession.ts", import.meta.url), "utf8");
const controlSource = readFileSync(
  new URL("../../../src/services/autoClose.ts", import.meta.url),
  "utf8",
);
const routesSource = readFileSync(new URL("../atom/headless/routes.ts", import.meta.url), "utf8");

test("Core owns the auto-close deadline and wait-song-end decision", () => {
  assert.match(sessionSource, /autoCloseTimer = setTimeout\(onAutoCloseDeadline, delay\)/);
  assert.match(sessionSource, /autoClose\.pendingStopOnEnd = true/);
  assert.match(sessionSource, /invalidatePlaybackPreload\(\)/);
  assert.match(sessionSource, /if \(consumeAutoCloseOnEnded\(\)\) return true/);
  assert.match(sessionSource, /autoClose: \{ \.\.\.autoClose \}/);
});

test("Control auto-close service only projects countdown and sends Core commands", () => {
  const tick = controlSource.split("const tick = (): void => {")[1]?.split("const startTick")[0];
  assert.ok(tick, "Control countdown tick should exist");
  assert.doesNotMatch(tick, /\.pause\(/);
  assert.match(controlSource, /setSessionAutoClose\(duration, waitSongEnd\)/);
  assert.match(controlSource, /cancelSessionAutoClose\(\)/);
  assert.match(controlSource, /applySnapshot/);
});

test("Headless Web exposes the same Core auto-close commands", () => {
  assert.match(routesSource, /api\.post\("\/session\/auto-close"/);
  assert.match(routesSource, /setAutoClose\(durationMin, body\?\.waitSongEnd === true\)/);
  assert.match(routesSource, /api\.delete\("\/session\/auto-close"/);
  assert.match(routesSource, /cancelAutoClose\(\)/);
});
