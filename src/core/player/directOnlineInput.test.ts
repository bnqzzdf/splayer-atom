import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const playerSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const audioSource = readFileSync(new URL("../../services/audioSource.ts", import.meta.url), "utf8");
const preloaderSource = readFileSync(
  new URL("../../services/nextTrackPreloader.ts", import.meta.url),
  "utf8",
);
const mainPlayerLoadSource = readFileSync(
  new URL("../../../electron/main/services/playerLoad.ts", import.meta.url),
  "utf8",
);

const between = (source: string, start: string, end: string): string => {
  const afterStart = source.split(start)[1];
  assert.ok(afterStart, `missing start marker: ${start}`);
  const section = afterStart.split(end)[0];
  assert.ok(section, `missing end marker: ${end}`);
  return section;
};

test("remote Direct input becomes local before native load", () => {
  const preparation = between(
    audioSource,
    "export const prepareDirectTrackSource = async (",
    "/**\n * 记录解析错误",
  );
  assert.match(preparation, /track\.source === "local"/);
  assert.doesNotMatch(preparation, /track\.source === "qobuz" \|\| track\.source === "tidal"/);
  assert.match(preparation, /outputDevice/);
  assert.match(preparation, /cache\.song\.fetch/);
  assert.match(preparation, /materializeDirectInput/);

  const loadFlow = between(
    playerSource,
    "const loadTrackSourceWithFallback = async (",
    "/**\n * 加载指定 Track",
  );
  assert.match(loadFlow, /prepareDirectTrackSource\(track, resolved\)/);
  assert.match(loadFlow, /load\(prepared\.source/);
  assert.doesNotMatch(loadFlow, /load\(resolved\.source/);

  const preparationFailure = between(loadFlow, "if (!prepared) {", "const result = await load(");
  assert.match(preparationFailure, /ErrorCode\.NETWORK_ERROR/);
  assert.doesNotMatch(preparationFailure, /markRetryableSourceFailure/);
  assert.match(loadFlow, /strictOnlineDirect/);
  assert.match(loadFlow, /!strictOnlineDirect/);
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

test("Diretta next-track staging prepares online input before native gapless staging", () => {
  const schedule = between(
    preloaderSource,
    "export const scheduleNextTrackPreload = (): void => {",
    "/** 安装预载上下文监听 */",
  );
  const prepareIndex = schedule.indexOf("prepareDirectTrackSource(candidateTrack, source)");
  const stageIndex = schedule.indexOf("stageDirectNext(");
  assert.ok(prepareIndex >= 0);
  assert.ok(stageIndex > prepareIndex);
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
