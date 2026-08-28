import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sessionSource = readFileSync(new URL("./playbackSession.ts", import.meta.url), "utf8");
const preloaderSource = readFileSync(new URL("./playbackPreloader.ts", import.meta.url), "utf8");
const desktopBridgeSource = readFileSync(new URL("../ipc/player.ts", import.meta.url), "utf8");
const rendererPreloaderSource = readFileSync(
  new URL("../../../src/services/nextTrackPreloader.ts", import.meta.url),
  "utf8",
);

test("Desktop and Node share the same Core native lifecycle handlers", () => {
  for (const marker of [
    "export const onNativeEnded = (): boolean => {",
    "export const onNativeSourceError = (): boolean => {",
    "export const onNativeDirectTrackBoundary = (",
  ]) {
    const section = sessionSource.split(marker)[1];
    assert.ok(section, `missing Core handler: ${marker}`);
    assert.doesNotMatch(section.split("};")[0], /isHeadlessMode/);
  }

  assert.match(desktopBridgeSource, /playbackSession\.onNativeEnded\(\)/);
  assert.match(desktopBridgeSource, /playbackSession\.onNativeSourceError\(\)/);
  assert.match(
    desktopBridgeSource,
    /playbackSession\.onNativeDirectTrackBoundary\(generation, duration\)/,
  );
});

test("renderer only receives lifecycle events that Core did not consume", () => {
  const ended = desktopBridgeSource
    .split('case "ended": {')[1]
    ?.split('case "directTrackBoundary"')[0];
  assert.ok(ended);
  assert.match(ended, /if \(!consumedBySession\) sendToMain/);

  const direct = desktopBridgeSource
    .split('case "directTrackBoundary": {')[1]
    ?.split('case "sourceError"')[0];
  assert.ok(direct);
  assert.match(direct, /onNativeDirectTrackBoundary\(generation, duration\)/);
  assert.match(direct, /if \(!consumedBySession\)/);

  const sourceError = desktopBridgeSource
    .split('case "sourceError": {')[1]
    ?.split('case "position"')[0];
  assert.ok(sourceError);
  assert.match(sourceError, /if \(!consumedBySession\) sendToMain/);
});

test("Core is the only playable-input and Direct preload owner for Desktop too", () => {
  assert.doesNotMatch(preloaderSource, /isHeadlessMode/);
  const rendererSchedule = rendererPreloaderSource
    .split("export const scheduleNextTrackPreload = (): void => {")[1]
    ?.split("/** 安装预载上下文监听 */")[0];
  assert.ok(rendererSchedule);
  assert.match(rendererSchedule, /preloadLyricForTrack/);
  assert.match(rendererSchedule, /preloadCover/);
  assert.doesNotMatch(
    rendererSchedule,
    /resolveTrackSource|prepareDirectTrackSource|stageDirectNext|materializeDirectInput/,
  );
});

test("Personal FM natural lifecycle ignores stale repeat-one and keeps provider pool aligned", () => {
  const ended = sessionSource.split("export const onNativeEnded = (): boolean => {")[1];
  assert.ok(ended);
  assert.match(ended, /mode !== "personalFm" && repeat === "one"/);

  const direct = sessionSource.split("export const onNativeDirectTrackBoundary = (")[1];
  assert.ok(direct);
  assert.match(direct, /alignPersonalFmPool\(prepared\.queueIndex\)/);
});
