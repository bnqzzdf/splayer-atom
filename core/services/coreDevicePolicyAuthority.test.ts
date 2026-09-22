import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const deviceSource = readFileSync(new URL("./device.ts", import.meta.url), "utf8");
const sessionSource = readFileSync(new URL("./playbackSession.ts", import.meta.url), "utf8");
const settingsSource = readFileSync(
  new URL("../../shared/types/settings.ts", import.meta.url),
  "utf8",
);
const categorySource = readFileSync(
  new URL("../../src/settings/categories/player.ts", import.meta.url),
  "utf8",
);

test("pause-on-device-switch is a Core playback policy", () => {
  assert.match(settingsSource, /pauseOnDeviceSwitch: boolean/);
  assert.match(sessionSource, /store\.get\("player\.pauseOnDeviceSwitch"\)/);
  assert.doesNotMatch(deviceSource, /let pauseOnDeviceSwitch/);
  assert.doesNotMatch(deviceSource, /requestReinit|reinitOutput/);
});

test("Control settings bind directly to the Core policy path", () => {
  assert.match(categorySource, /path: "system\.player\.pauseOnDeviceSwitch"/);
  assert.doesNotMatch(categorySource, /setPauseOnDeviceSwitch\(Boolean\(enabled\)\)/);
});
