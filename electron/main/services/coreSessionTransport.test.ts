import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sessionSource = readFileSync(new URL("./playbackSession.ts", import.meta.url), "utf8");
const ipcSource = readFileSync(new URL("../ipc/player.ts", import.meta.url), "utf8");
const controlSource = readFileSync(
  new URL("../../../src/core/player/index.ts", import.meta.url),
  "utf8",
);
const routesSource = readFileSync(new URL("../atom/headless/routes.ts", import.meta.url), "utf8");

test("Desktop transport delegates play pause stop and seek to the Core session", () => {
  assert.match(ipcSource, /await playbackSession\.play\(\)/);
  assert.match(ipcSource, /playbackSession\.pause\(\)/);
  assert.match(ipcSource, /playbackSession\.stop\(\)/);
  assert.match(ipcSource, /await playbackSession\.seek\(positionMs\)/);
});

test("Core reload-current captures native position and play state before fresh loading", () => {
  const reload = sessionSource.split("export const reloadCurrent = async (")[1];
  assert.ok(reload, "Core reload-current command should exist");
  const body = reload.split("export const startPersonalFm")[0] ?? reload;
  assert.match(body, /player\.getStatus\(\)\.state/);
  assert.match(body, /toDisplayPositionMs\(toMs\(player\.getPosition\(\)\)\)/);
  assert.match(body, /await loadIndex\(index, false\)/);
  assert.match(body, /await seek\(resumePositionMs\)/);
  assert.match(body, /if \(shouldPlay\) await play\(\)/);
  assert.doesNotMatch(body, /loadIndexWithPolicy/);
});

test("Control reload and startup recovery no longer resolve or load playable URLs", () => {
  assert.doesNotMatch(controlSource, /resolveTrackSource|loadTrackSourceWithFallback/);
  const reload = controlSource.split("export const reloadCurrentTrack = async (")[1];
  assert.ok(reload);
  assert.match(reload.split("};")[0], /reloadSessionCurrent\(forcePlay\)/);
  assert.match(controlSource, /reloadSessionCurrent\(settings\.system\.player\.autoPlay\)/);
});

test("Desktop system media controls also use Core transport", () => {
  const mediaControls = ipcSource.split("mediaService.onEvent((event: MediaEvent) => {")[1] ?? "";
  assert.match(mediaControls, /playbackSession\.play\(\)/);
  assert.match(mediaControls, /playbackSession\.pause\(\)/);
  assert.match(mediaControls, /playbackSession\.stop\(\)/);
  assert.match(mediaControls, /playbackSession\.seek\(targetMs\)/);
  assert.doesNotMatch(mediaControls, /inst\.play\(|inst\.pause\(|inst\.stop\(|inst\.seek\(/);
});

test("Headless Web exposes the same Core reload-current command", () => {
  assert.match(routesSource, /api\.post\("\/session\/reload"/);
  assert.match(routesSource, /await reloadCurrent\(body\?\.forcePlay\)/);
});
