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

test("Core resolves and materializes the current canonical Track before a Diretta switch", () => {
  const resolveIndex = outputSwitch.indexOf("resolvePlaybackSource(item.track)");
  const materializeIndex = outputSwitch.indexOf("materializeDirectInput(previousResolved.source)");
  const stopIndex = outputSwitch.indexOf("player.stop()");
  const switchIndex = outputSwitch.indexOf("player.setOutputDevice(deviceId ?? undefined)");
  assert.ok(resolveIndex >= 0);
  const identityGuardIndex = outputSwitch.indexOf("loadGeneration !== playbackGeneration");
  assert.ok(materializeIndex > resolveIndex);
  assert.ok(identityGuardIndex > materializeIndex);
  assert.ok(stopIndex > identityGuardIndex);
  assert.ok(switchIndex > stopIndex);
});

test("Core output switching restores old output and playback when the switch itself fails", () => {
  assert.match(outputSwitch, /player\.setOutputDevice\(previousPreference \?\? undefined\)/);
  assert.match(outputSwitch, /await loadIndex\(index, false, false, previousResolved\)/);
  assert.match(outputSwitch, /if \(resumePositionMs > 0\) await seek\(resumePositionMs\)/);
  assert.match(outputSwitch, /if \(state === "playing"\) await play\(\)/);
});

test("Core applies pause-on-device-switch policy when restoring playback on the new output", () => {
  assert.match(outputSwitch, /store\.get\("player\.pauseOnDeviceSwitch"\) !== true/);
  assert.match(outputSwitch, /await loadIndex\(index, false, false, targetResolved\)/);
  assert.match(outputSwitch, /if \(shouldResumePlaying\) await play\(\)/);
});

test("Desktop Control only sends the output id and never prepares or reloads a source", () => {
  const controlSwitch =
    controlSource.split("export const switchDevice = async (")[1]?.split("/**\n * 设置队列")[0] ??
    "";
  assert.match(controlSwitch, /window\.api\.player\.setOutputDevice\(deviceId\)/);
  assert.doesNotMatch(
    controlSwitch,
    /prepareDirectTrackSource|materializeDirectInput|\.load\(|\.stop\(/,
  );
  assert.match(ipcSource, /await playbackSession\.setOutputDevice\(deviceId\)/);
});
