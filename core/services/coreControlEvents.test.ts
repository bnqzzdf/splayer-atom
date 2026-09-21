import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (url: URL): string => readFileSync(url, "utf8");
const publisherSource = read(new URL("./coreControlEvents.ts", import.meta.url));
const eventClientSource = read(new URL("../../src/core/controlEventClient.ts", import.meta.url));
const eventTypesSource = read(new URL("../../shared/types/coreEvents.ts", import.meta.url));
const corePlayerEventsSource = read(new URL("./corePlayerEvents.ts", import.meta.url));
const playbackSessionSource = read(new URL("./playbackSession.ts", import.meta.url));
const playerLoadSource = read(new URL("./playerLoad.ts", import.meta.url));
const deviceSource = read(new URL("./device.ts", import.meta.url));
const playerControlSource = read(new URL("../../src/core/player/index.ts", import.meta.url));
const wsBroadcastSource = read(new URL("../server/broadcast.ts", import.meta.url));

test("Core Domain projections use one WebSocket event envelope", () => {
  assert.match(publisherSource, /wsBroadcast\(event\)/);
  assert.match(eventClientSource, /new WebSocket\(`\$\{wsOrigin\}\/ws`\)/);
  assert.doesNotMatch(eventClientSource, /connectDesktop|CoreEventsApi|atomRuntime/);
});

test("shared Core event contract stays limited to pure domain projections", () => {
  for (const type of [
    "providerSessions",
    "libraryScanProgress",
    "downloadState",
    "downloadProgress",
    "streamingLibraryUpdated",
    "lyricOffset",
    "pluginStatus",
  ]) {
    assert.match(eventTypesSource, new RegExp(`type: "${type}"`));
  }
  for (const type of ["status", "trackLoaded", "position", "error", "deviceChanged", "session"]) {
    assert.match(eventTypesSource, new RegExp(type));
  }
  assert.doesNotMatch(
    eventTypesSource,
    /type: "(?:play|pause|next|prev|toggleLike|setRepeat|setShuffle)"/,
  );
});

test("Player projections are published only by Core and consumed by Web Control", () => {
  assert.match(corePlayerEventsSource, /publishCoreControlEvent\(\{\s*type: "status"/s);
  assert.match(playerLoadSource, /publishCoreControlEvent\(loadingEvent\)/);
  assert.match(playbackSessionSource, /publishCoreControlEvent\(\{ type: "session", data \}\)/);
  assert.match(playbackSessionSource, /publishCoreControlEvent\(event\)/);
  assert.doesNotMatch(deviceSource, /defaultDevice|publishCoreControlEvent/);
  assert.doesNotMatch(deviceSource, /requestReinit|REINIT_DELAY_MS|reinitOutput/);
  assert.match(corePlayerEventsSource, /publishCoreControlEvent\(\{\s*type: "position"/s);
  assert.match(wsBroadcastSource, /HIGH_FREQ_EVENTS = new Set\(\["position"\]\)/);
  assert.match(playerControlSource, /subscribeCorePlayerProjection\(handleEvent\)/);
  assert.doesNotMatch(playerControlSource, /window\.api\.player|webRemote|isWebRemote/);
});
