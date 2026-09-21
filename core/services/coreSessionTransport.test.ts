import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sessionSource = readFileSync(new URL("./playbackSession.ts", import.meta.url), "utf8");
const controlSource = readFileSync(
  new URL("../../src/core/player/index.ts", import.meta.url),
  "utf8",
);
const routesSource = readFileSync(new URL("../atom/headless/routes.ts", import.meta.url), "utf8");
const playerControlSource = readFileSync(new URL("./playerControl.ts", import.meta.url), "utf8");
const controlRoutesSource = readFileSync(
  new URL("../atom/controlRoutes.ts", import.meta.url),
  "utf8",
);
const controlClientSource = readFileSync(
  new URL("../../src/core/controlClient.ts", import.meta.url),
  "utf8",
);
const sessionClientSource = readFileSync(
  new URL("../../src/core/sessionClient.ts", import.meta.url),
  "utf8",
);
const queueStoreSource = readFileSync(
  new URL("../../src/stores/queue.ts", import.meta.url),
  "utf8",
);
const fmDialogSource = readFileSync(
  new URL("../../src/components/modals/FmModeDialog.vue", import.meta.url),
  "utf8",
);
const autoCloseSource = readFileSync(
  new URL("../../src/services/autoClose.ts", import.meta.url),
  "utf8",
);

test("Web play pause stop and seek use the Core Protocol routes", () => {
  assert.match(controlRoutesSource, /buildHeadlessRoutes\(\)/);
  assert.match(controlRoutesSource, /buildAtomCompatRoutes\(\)/);
  assert.match(controlClientSource, /assertCoreProtocolCompatible\(info\)/);
  assert.match(controlClientSource, /fetch\(`\$\{coreApiOrigin\}\/api\$\{path\}`/);
  assert.doesNotMatch(controlClientSource, /atom-core:|atomRuntime|ipcRenderer|electron/);

  assert.match(controlSource, /coreCommand\("\/play"\)/);
  assert.match(controlSource, /coreCommand\("\/pause"\)/);
  assert.match(controlSource, /coreCommand\("\/stop"\)/);
  assert.match(controlSource, /coreCommand\("\/seek", \{ positionMs: posMs \}\)/);
  assert.doesNotMatch(controlSource, /window\.api\.player\.(play|pause|stop|seek)\(/);
  assert.doesNotMatch(autoCloseSource, /coreCommand\("\/pause"\)|window\.api/);

  assert.match(routesSource, /api\.post\("\/play"/);
  assert.match(routesSource, /api\.post\("\/pause"/);
  assert.match(routesSource, /api\.post\("\/stop"/);
  assert.match(routesSource, /api\.post\("\/seek"/);
});

test("Web session and queue commands use the shared Core Protocol client", () => {
  assert.match(sessionClientSource, /coreResult<PlaybackSessionSnapshot>\("\/session"\)/);
  assert.match(sessionClientSource, /"\/session\/queue\/select"/);
  assert.match(sessionClientSource, /"\/session\/personal-fm"/);
  assert.match(sessionClientSource, /"\/session\/auto-close"/);
  assert.match(
    sessionClientSource,
    /`\/session\/queue\/\$\{index\}\?loadCurrent=\$\{loadCurrent \? "1" : "0"\}`/,
  );

  assert.match(routesSource, /c\.req\.query\("loadCurrent"\) !== "0"/);
  assert.match(routesSource, /removeQueueIndex\(index, loadCurrent\)/);

  const sessionIpc =
    /window\.api\.player\s*\.\s*(getSession|reloadSessionCurrent|migrateLegacySessionQueue|replaceSessionQueue|appendSessionQueue|insertSessionQueue|removeSessionQueueIndex|selectSessionIndex|nextSession|prevSession|updateSessionQueueItem|moveSessionQueue|removeSessionServerTracks|updateSessionQueueTracks|clearSessionQueue|setSessionRepeat|setSessionShuffle|startPersonalFm|dislikePersonalFm|setSessionAutoClose|cancelSessionAutoClose)/;
  assert.doesNotMatch(controlSource, sessionIpc);
  assert.doesNotMatch(queueStoreSource, sessionIpc);
  assert.doesNotMatch(autoCloseSource, sessionIpc);
  assert.doesNotMatch(fmDialogSource, sessionIpc);
  assert.doesNotMatch(sessionClientSource, /window\.api|ipcRenderer|electron/);
});

test("Core reload-current captures current output position and play state before fresh loading", () => {
  const reload = sessionSource.split("export const reloadCurrent = async (")[1];
  assert.ok(reload, "Core reload-current command should exist");
  const body = reload.split("export const startPersonalFm")[0] ?? reload;
  assert.match(body, /const currentStatus = getPlaybackStatus\(\)/);
  assert.match(body, /const state = currentStatus\.state/);
  assert.match(body, /const resumePositionMs = currentStatus\.position/);
  assert.match(body, /await loadIndex\(index, false, \{ preserveListenBrainzSession: true \}\)/);
  assert.match(body, /await seek\(resumePositionMs\)/);
  assert.match(body, /if \(shouldPlay\) await play\(\)/);
  assert.doesNotMatch(body, /loadIndexWithPolicy/);
});

test("Control reload and startup recovery no longer resolve or load playable URLs", () => {
  assert.doesNotMatch(controlSource, /resolveTrackSource|loadTrackSourceWithFallback/);
  const reload = controlSource.split("export const reloadCurrentTrack = async (")[1];
  assert.ok(reload);
  assert.match(reload.split("};")[0], /reloadSessionCurrent\(forcePlay\)/);
  assert.match(controlSource, /const session = await queue\.restoreQueue\(\)/);
  assert.match(controlSource, /const currentStatus = await playerClient\.getStatus\(\)/);
  assert.doesNotMatch(controlSource, /loadTrack\(|resolvePlaybackSource|materializeDirectInput/);
});

test("Web exposes the Core reload-current command", () => {
  assert.match(routesSource, /api\.post\("\/session\/reload"/);
  assert.match(routesSource, /await reloadCurrent\(body\?\.forcePlay\)/);
});

test("Web rebuilds audio output through the Core service", () => {
  assert.match(
    playerControlSource,
    /reinitOutput: \(\): Promise<void> => playbackSession\.reinitOutput\(\)/,
  );
  assert.match(sessionSource, /export const reinitOutput = async \(\): Promise<void> =>/);
  const reinit = sessionSource.split("export const reinitOutput = async")[1]?.split("export const startPersonalFm")[0] ?? "";
  assert.match(reinit, /await loadIndex\(index, false/);
  assert.match(reinit, /if \(resumePositionMs > 0\) await seek\(resumePositionMs\)/);
  assert.doesNotMatch(reinit, /getPlayer\(\)\.reinitOutput|resolveTrackSource/);
  assert.match(routesSource, /api\.post\("\/player\/reinit"/);
  assert.match(routesSource, /await playerControl\.reinitOutput\(\)/);
});
