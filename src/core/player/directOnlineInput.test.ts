import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const playerSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const preloaderSource = readFileSync(
  new URL("../../services/nextTrackPreloader.ts", import.meta.url),
  "utf8",
);
const mainPlayerLoadSource = readFileSync(
  new URL("../../../electron/main/services/playerLoad.ts", import.meta.url),
  "utf8",
);
const corePreloaderSource = readFileSync(
  new URL("../../../electron/main/services/playbackPreloader.ts", import.meta.url),
  "utf8",
);
const coreSessionSource = readFileSync(
  new URL("../../../electron/main/services/playbackSession.ts", import.meta.url),
  "utf8",
);

const between = (source: string, start: string, end: string): string => {
  const afterStart = source.split(start)[1];
  assert.ok(afterStart, `missing start marker: ${start}`);
  const section = afterStart.split(end)[0];
  assert.ok(section, `missing end marker: ${end}`);
  return section;
};

test("canonical source resolution is owned by Core before native load", () => {
  assert.doesNotMatch(playerSource, /resolveTrackSource|loadTrackSourceWithFallback/);
  const loadFlow = between(
    coreSessionSource,
    "const loadIndex = async (",
    "const loadIndexWithPolicy = async (",
  );
  assert.match(loadFlow, /resolvePlaybackSource\(track\)/);
  assert.match(loadFlow, /loadPlayerSource\(resolved\.source/);
});

test("main player load materializes every remote source before Diretta native load", () => {
  const loadFlow = between(
    mainPlayerLoadSource,
    "export const loadPlayerSource = async (",
    "playerLog.debug(`加载成功: ${displayTitle}`)",
  );
  assert.match(loadFlow, /getSelectedDeviceName\(\)\?\.startsWith\("diretta:"\)/);
  assert.match(loadFlow, /\^https\?:\\\/\\\//i);
  assert.match(loadFlow, /loadSource = await materializeDirectInput\(source\)/);
  assert.match(loadFlow, /inst\.load\(loadSource/);
  assert.doesNotMatch(loadFlow, /track\.source === "qobuz" \|\| track\.source === "tidal"/);
});

test("Diretta next-track staging is owned by Core rather than renderer Control", () => {
  const rendererSchedule = between(
    preloaderSource,
    "export const scheduleNextTrackPreload = (): void => {",
    "/** 安装预载上下文监听 */",
  );
  assert.doesNotMatch(
    rendererSchedule,
    /resolveTrackSource|prepareDirectTrackSource|stageDirectNext/,
  );
  assert.match(rendererSchedule, /preloadLyricForTrack/);

  const coreSchedule = between(
    corePreloaderSource,
    "export const schedulePlaybackPreload = (",
    "/** 仅当队列位置、canonical Track 与 Core playback policy 全部一致时消费普通预载。 */",
  );
  assert.match(coreSchedule, /resolvePlaybackSource/);
  assert.match(coreSchedule, /prepareDirectSource/);
  assert.match(coreSchedule, /stageDirectSource/);
});

test("switching any remote HTTP track into Diretta prepares local input first", () => {
  const switchFlow = between(
    playerSource,
    "export const switchDevice = async (",
    "/**\n * 设置队列并从指定位置开始播放",
  );
  assert.match(switchFlow, /prepareDirectTrackSource/);
  assert.match(switchFlow, /\^https\?:\\\/\\\//i);
  assert.doesNotMatch(switchFlow, /track\.source === "qobuz" \|\| track\.source === "tidal"/);
  assert.match(switchFlow, /deviceId/);
  assert.match(switchFlow, /window\.api\.player\.stop/);
  assert.match(switchFlow, /setOutputDevice\(deviceId, false\)/);
  assert.match(switchFlow, /load\(prepared\.source/);
});
