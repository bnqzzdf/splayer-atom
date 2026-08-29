import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (url: URL): string => readFileSync(url, "utf8");
const publisherSource = read(new URL("./coreControlEvents.ts", import.meta.url));
const preloadSource = read(new URL("../../preload/index.ts", import.meta.url));
const eventClientSource = read(new URL("../../../src/core/controlEventClient.ts", import.meta.url));
const eventTypesSource = read(new URL("../../../shared/types/coreEvents.ts", import.meta.url));
const playerIpcSource = read(new URL("../ipc/player.ts", import.meta.url));
const corePlayerEventsSource = read(new URL("./corePlayerEvents.ts", import.meta.url));
const playbackSessionSource = read(new URL("./playbackSession.ts", import.meta.url));
const playerLoadSource = read(new URL("./playerLoad.ts", import.meta.url));
const deviceSource = read(new URL("./device.ts", import.meta.url));
const playerControlSource = read(new URL("../../../src/core/player/index.ts", import.meta.url));
const webApiSource = read(new URL("../../../src/web/api.ts", import.meta.url));

test("Core Domain projections use one event envelope on Desktop and Web", () => {
  assert.match(publisherSource, /publishDesktopEvent\("core:event", event\)/);
  assert.match(publisherSource, /wsBroadcast\(event\)/);
  assert.match(preloadSource, /ipcRenderer\.removeAllListeners\("core:event"\)/);
  assert.match(preloadSource, /subscribe<CoreControlEvent>\("core:event", callback\)/);
  assert.match(eventClientSource, /coreEvents: CoreEventsApi/);
  assert.match(eventClientSource, /return coreEvents\.onEvent/);
  assert.match(eventClientSource, /new WebSocket\(`\$\{wsOrigin\}\/ws`\)/);
});

test("shared Core event contract stays limited to pure domain projections", () => {
  for (const type of [
    "providerSessions",
    "libraryScanProgress",
    "downloadState",
    "downloadProgress",
  ]) {
    assert.match(eventTypesSource, new RegExp(`type: "${type}"`));
  }
  for (const type of ["status", "trackLoaded", "error", "deviceChanged", "session"]) {
    assert.match(eventTypesSource, new RegExp(type));
  }
  assert.doesNotMatch(
    eventTypesSource,
    /type: "(?:play|pause|next|prev|toggleLike|setRepeat|setShuffle)"/,
  );
});

test("low-frequency Player projections use core:event while legacy player:event keeps Host semantics", () => {
  assert.match(playerIpcSource, /publishCoreControlEvent\(statusEvent\)/);
  assert.match(corePlayerEventsSource, /publishCoreControlEvent\(\{\s*type: "status"/s);
  assert.match(playerLoadSource, /publishCoreControlEvent\(loadingEvent\)/);
  assert.match(playbackSessionSource, /publishCoreControlEvent\(\{ type: "session", data \}\)/);
  assert.match(playbackSessionSource, /publishCoreControlEvent\(event\)/);
  assert.match(deviceSource, /publishCoreControlEvent\(\{\s*type: "deviceChanged"/s);
  assert.match(playerControlSource, /subscribeCorePlayerProjection\(handleEvent\)/);
  assert.match(
    webApiSource,
    /isCoreControlEvent\(event\) && !isCorePlayerProjectionEvent\(event\)/,
  );

  assert.doesNotMatch(playerIpcSource, /sendToMain\("player:event", statusEvent\)/);
  assert.doesNotMatch(playerLoadSource, /publishDesktopEvent\("player:event", loadingEvent\)/);
  assert.doesNotMatch(
    playbackSessionSource,
    /publishDesktopEvent\("player:event", \{ type: "session"/,
  );
  assert.match(playerIpcSource, /sendToMain\("player:event", \{ type: "next" \}\)/);
  assert.match(playerIpcSource, /sendToMain\("player:event", positionEvent\)/);
  assert.match(playerIpcSource, /sendToMain\("player:event", fftEvent\)/);
  assert.match(playerIpcSource, /sendToMain\("player:event", \{ type: "sourceError" \}\)/);
});
