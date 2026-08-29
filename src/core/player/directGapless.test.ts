import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const eventsSource = readFileSync(new URL("./events.ts", import.meta.url), "utf8");
const preloaderSource = readFileSync(
  new URL("../../services/nextTrackPreloader.ts", import.meta.url),
  "utf8",
);
const audioSource = readFileSync(new URL("../../services/audioSource.ts", import.meta.url), "utf8");
const sharedPlayerSource = readFileSync(
  new URL("../../../shared/types/player.ts", import.meta.url),
  "utf8",
);
const preloadSource = readFileSync(
  new URL("../../../electron/preload/index.ts", import.meta.url),
  "utf8",
);
const mainPlayerSource = readFileSync(
  new URL("../../../electron/main/ipc/player.ts", import.meta.url),
  "utf8",
);
const headlessRoutesSource = readFileSync(
  new URL("../../../electron/main/atom/headless/routes.ts", import.meta.url),
  "utf8",
);
const webApiSource = readFileSync(new URL("../../web/api.ts", import.meta.url), "utf8");
const directGaplessServiceSource = readFileSync(
  new URL("../../../electron/main/services/directGapless.ts", import.meta.url),
  "utf8",
);
const corePreloaderSource = readFileSync(
  new URL("../../../electron/main/services/playbackPreloader.ts", import.meta.url),
  "utf8",
);
const sessionSource = readFileSync(
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

test("Direct gapless boundary is committed by Core before Control projection", () => {
  const coreBoundary = between(
    sessionSource,
    "export const onNativeDirectTrackBoundary = (",
    "const consumeAutoCloseOnEnded",
  );
  assert.match(coreBoundary, /consumeDirectPlaybackBoundary\(generation, queue\)/);
  assert.match(coreBoundary, /commitDirectPlaybackBoundary\(/);
  assert.match(coreBoundary, /publishTrackLoaded\(/);
  assert.match(coreBoundary, /scheduleNextPlaybackPreload\(\)/);

  const rendererBoundary = between(
    eventsSource,
    'case "directTrackBoundary": {',
    'case "sourceError":',
  );
  assert.match(rendererBoundary, /只有未消费的异常边界才会到 Desktop renderer/);
  assert.match(rendererBoundary, /await stop\(\)/);
  assert.doesNotMatch(
    rendererBoundary,
    /consumeDirectGaplessBoundary|commitDirectGaplessTrack|commitDirectGaplessBoundary/,
  );
});

test("Direct staging respects Core playback semantics before handing audio to native", () => {
  assert.match(preloaderSource, /renderer 只利用 Chromium 预热下一首歌词与封面/);
  assert.doesNotMatch(
    preloaderSource,
    /stageDirectNext|cancelDirectNext|directGeneration|materializeDirectInput/,
  );
  assert.match(corePreloaderSource, /getSelectedDeviceName\(\)\?\.startsWith\("diretta:"\)/);
  assert.match(corePreloaderSource, /track\.cueStartMs != null \|\| track\.cueEndMs != null/);
  assert.match(corePreloaderSource, /stageDirectPlaybackNext/);
  assert.match(sessionSource, /autoClose\.enabled && autoClose\.waitSongEnd/);
  assert.match(sessionSource, /nextPlaybackPreloadIndex/);
});

test("Core Direct boundary prunes superseded temporary online inputs", () => {
  assert.match(sessionSource, /commitDirectPlaybackBoundary\(prepared\.directSource/);
  assert.match(directGaplessServiceSource, /commitDirectGaplessBoundary/);
  assert.match(directGaplessServiceSource, /pruneDirectInputs\(source\)/);
});

test("renderer-facing Direct staging and materialization protocol is removed end to end", () => {
  const forbidden =
    /stageDirectNext|cancelDirectNext|commitDirectGaplessBoundary|materializeDirectInput/;
  assert.doesNotMatch(sharedPlayerSource, forbidden);
  assert.doesNotMatch(
    preloadSource,
    /player:(stageDirectNext|cancelDirectNext|commitDirectGaplessBoundary|materializeDirectInput)/,
  );
  assert.doesNotMatch(
    mainPlayerSource,
    /player:(stageDirectNext|cancelDirectNext|commitDirectGaplessBoundary|materializeDirectInput)/,
  );
  assert.doesNotMatch(headlessRoutesSource, /\/player\/direct-input\/materialize/);
  assert.doesNotMatch(
    webApiSource,
    /WEB_DIRECT_STAGING_DISABLED|\/player\/direct-input\/materialize/,
  );
  assert.doesNotMatch(
    audioSource,
    /prepareDirectTrackSource|window\.api\.player\.materializeDirectInput/,
  );
});
