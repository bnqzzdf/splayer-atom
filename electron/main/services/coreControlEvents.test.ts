import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (url: URL): string => readFileSync(url, "utf8");
const publisherSource = read(new URL("./coreControlEvents.ts", import.meta.url));
const preloadSource = read(new URL("../../preload/index.ts", import.meta.url));
const eventClientSource = read(new URL("../../../src/core/controlEventClient.ts", import.meta.url));
const eventTypesSource = read(new URL("../../../shared/types/coreEvents.ts", import.meta.url));

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
  assert.doesNotMatch(eventTypesSource, /play|pause|next|prev|toggleLike|setRepeat|setShuffle/);
});
