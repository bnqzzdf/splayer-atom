import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sessionSource = readFileSync(new URL("./playbackSession.ts", import.meta.url), "utf8");
const preloaderSource = readFileSync(new URL("./playbackPreloader.ts", import.meta.url), "utf8");
const rendererPreloaderSource = readFileSync(
  new URL("../../src/services/nextTrackPreloader.ts", import.meta.url),
  "utf8",
);
const rendererEventsSource = readFileSync(
  new URL("../../src/core/player/events.ts", import.meta.url),
  "utf8",
);

test("Core owns native playback lifecycle handlers", () => {
  for (const marker of [
    "export const onNativePosition = (enginePositionMs: number): boolean => {",
    "export const onNativeEnded = (): boolean => {",
    "export const onNativeSourceError = (): boolean => {",
    "export const onNativeDirectTrackBoundary = (",
  ]) {
    assert.match(sessionSource, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("Core owns CUE virtual-track end boundaries", () => {
  const cueBoundary = sessionSource.split(
    "export const onNativePosition = (enginePositionMs: number): boolean => {",
  )[1];
  assert.ok(cueBoundary);
  const body = cueBoundary.split("/** Native ended")[0];
  assert.match(body, /const cueEndMs = track\?\.cueEndMs/);
  assert.match(body, /enginePositionMs < cueEndMs/);
  assert.match(body, /getPlayer\(\)\.pauseImmediately\(\)/);
  assert.match(body, /advanceAfterNaturalEnd\(\)/);
  assert.doesNotMatch(rendererEventsSource, /track\?\.cueEndMs|directTrackBoundary|sourceError/);
});

test("Core is the only playable-input and Direct preload owner", () => {
  assert.match(preloaderSource, /materializeDirectInput|stageDirectPlaybackNext/);
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
  const ended = sessionSource.split("const advanceAfterNaturalEnd = (): void => {")[1];
  assert.ok(ended);
  assert.match(ended.split("};")[0], /mode !== "personalFm" && repeat === "one"/);

  const direct = sessionSource.split("export const onNativeDirectTrackBoundary = (")[1];
  assert.ok(direct);
  assert.match(direct, /alignPersonalFmPool\(prepared\.queueIndex\)/);
});

test("No-repeat playback stops at the final queue item", () => {
  assert.match(sessionSource, /let repeat: RepeatMode = "off"/);
  const next = sessionSource.split(
    "export const next = async (loadCurrent = true): Promise<boolean> => {",
  )[1];
  assert.ok(next);
  const stopAtEnd = next.split("const target = index + 1 >= queue.length ? 0 : index + 1")[0];
  assert.match(stopAtEnd, /index \+ 1 >= queue\.length && repeat === "off"/);
  assert.match(stopAtEnd, /nowPlaying\.onPlayStateChange\("stopped"\)/);
  assert.match(stopAtEnd, /if \(shuffle === "on"/);
  assert.ok(stopAtEnd.indexOf('repeat === "off"') < stopAtEnd.indexOf('shuffle === "on"'));
});

test("Web display preload follows the Core repeat-off boundary", () => {
  assert.match(rendererPreloaderSource, /repeatMode: status\.repeatMode/);
  assert.match(rendererPreloaderSource, /status\.repeatMode/);
  assert.match(rendererEventsSource, /repeatMode/);
});
