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
const sourceResolverSource = readFileSync(
  new URL("../../../electron/main/services/playbackSourceResolver.ts", import.meta.url),
  "utf8",
);
const songCacheSource = readFileSync(
  new URL("../../../electron/main/services/songCache.ts", import.meta.url),
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
  assert.match(loadFlow, /let nativeResolved = resolved/);
  assert.match(loadFlow, /parseSacdPlaybackSource\(resolved\.source, track\.track\)/);
  assert.match(loadFlow, /loadPlayerSource\(\s*nativeResolved\.source/);
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

test("Direct materialization seeds song cache without a second remote fetch", () => {
  const playerLoadFlow = between(
    mainPlayerLoadSource,
    "export const loadPlayerSource = async (",
    "playerLog.debug(`加载成功: ${displayTitle}`)",
  );
  assert.match(playerLoadFlow, /runtime\.onDirectMaterialized\?\.\(loadSource\)/);
  assert.ok(
    playerLoadFlow.indexOf("runtime.onDirectMaterialized?.(loadSource)") <
      playerLoadFlow.indexOf("pruneDirectInputs(loadSource)"),
  );

  const sessionLoadFlow = between(
    coreSessionSource,
    "const loadIndex = async (",
    "const loadIndexWithPolicy = async (",
  );
  assert.match(sessionLoadFlow, /onDirectMaterialized: cacheResolvedSource/);
  assert.match(sessionLoadFlow, /\.cacheAfterLoad\(materializedSource\)/);
  assert.match(sessionLoadFlow, /!cacheStartedFromDirectInput/);

  assert.match(
    sourceResolverSource,
    /materializedSource[\s\S]*songCache\.importFileAsync\(cacheKey, track\.source, materializedSource\)/,
  );
  assert.match(songCacheSource, /export const importFileAsync = \(/);
  assert.match(songCacheSource, /fsp\.copyFile\(sourcePath, partPath\)/);
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

test("switching any remote HTTP track into Diretta prepares local input in Core", () => {
  const controlSwitch = between(
    playerSource,
    "export const switchDevice = async (",
    "/**\n * 设置队列并从指定位置开始播放",
  );
  assert.doesNotMatch(
    controlSwitch,
    /prepareDirectTrackSource|materializeDirectInput|player\.stop/,
  );
  assert.match(controlSwitch, /playerClient\.setOutputDevice\(deviceId\)/);

  const coreSwitch = coreSessionSource.split("export const setOutputDevice = async (")[1];
  assert.ok(coreSwitch);
  assert.match(coreSwitch, /resolvePlaybackSource\(item\.track\)/);
  assert.match(coreSwitch, /materializeDirectInput\(previousResolved\.source\)/);
  assert.match(coreSwitch, /resolvedOverride: targetResolved,\s*preserveListenBrainzSession: true/);
});
