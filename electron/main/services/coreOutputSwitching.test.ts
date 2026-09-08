import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sessionSource = readFileSync(new URL("./playbackSession.ts", import.meta.url), "utf8");
const ipcSource = readFileSync(new URL("../ipc/player.ts", import.meta.url), "utf8");
const controlSource = readFileSync(
  new URL("../../../src/core/player/index.ts", import.meta.url),
  "utf8",
);

const outputSwitch = sessionSource.split("export const setOutputDevice = async (")[1] ?? "";
const nativeOutputSwitch = outputSwitch.split("const state = player.getStatus().state;")[1] ?? "";

test("Core resolves and materializes the current canonical Track before a Diretta switch", () => {
  const resolveIndex = nativeOutputSwitch.indexOf("resolvePlaybackSource(item.track)");
  const materializeIndex = nativeOutputSwitch.indexOf(
    "materializeDirectInput(previousResolved.source)",
  );
  const stopIndex = nativeOutputSwitch.indexOf("player.stop()");
  const switchIndex = nativeOutputSwitch.indexOf("player.setOutputDevice(deviceId ?? undefined)");
  assert.ok(resolveIndex >= 0);
  const identityGuardIndex = nativeOutputSwitch.indexOf("loadGeneration !== playbackGeneration");
  assert.ok(materializeIndex > resolveIndex);
  assert.ok(identityGuardIndex > materializeIndex);
  assert.ok(stopIndex > identityGuardIndex);
  assert.ok(switchIndex > stopIndex);
});

test("Core output switching restores old output and playback when the switch itself fails", () => {
  assert.match(outputSwitch, /player\.setOutputDevice\(previousPreference \?\? undefined\)/);
  assert.match(
    outputSwitch,
    /resolvedOverride: previousResolved,\s*preserveListenBrainzSession: true/,
  );
  assert.match(outputSwitch, /if \(resumePositionMs > 0\) await seek\(resumePositionMs\)/);
  assert.match(outputSwitch, /if \(state === "playing"\) await play\(\)/);
});

test("Core applies pause-on-device-switch policy when restoring playback on the new output", () => {
  assert.match(outputSwitch, /store\.get\("player\.pauseOnDeviceSwitch"\) !== true/);
  assert.match(
    outputSwitch,
    /resolvedOverride: targetResolved,\s*preserveListenBrainzSession: true/,
  );
  assert.match(outputSwitch, /if \(shouldResumePlaying\) await play\(\)/);
});

test("Desktop Control only sends the output id and never prepares or reloads a source", () => {
  const controlSwitch =
    controlSource.split("export const switchDevice = async (")[1]?.split("/**\n * 设置队列")[0] ??
    "";
  assert.match(controlSwitch, /playerClient\.setOutputDevice\(deviceId\)/);
  assert.doesNotMatch(
    controlSwitch,
    /prepareDirectTrackSource|materializeDirectInput|\.load\(|\.stop\(/,
  );
  assert.match(ipcSource, /await playbackSession\.setOutputDevice\(deviceId\)/);
});
