import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sessionSource = readFileSync(new URL("./playbackSession.ts", import.meta.url), "utf8");
const controlSource = readFileSync(
  new URL("../../src/core/player/index.ts", import.meta.url),
  "utf8",
);
const nativeBindingSource = readFileSync(
  new URL("../../native/audio-engine/src/bindings/player.rs", import.meta.url),
  "utf8",
);

const outputSwitch = sessionSource.split("export const setOutputDevice = async (")[1] ?? "";
const nativeOutputSwitch = outputSwitch.split("const state = player.getStatus().state;")[1] ?? "";
const stopUpnpForSwitch =
  sessionSource.split("const stopUpnpOutputForSwitch = async (")[1]?.split("\n};")[0] ?? "";

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

test("Core output switching ignores an unavailable previous UPnP renderer", () => {
  const stopIndex = stopUpnpForSwitch.indexOf("await stopUpnpOutput()");
  const catchIndex = stopUpnpForSwitch.indexOf("catch (error)");
  assert.ok(stopIndex >= 0);
  assert.ok(catchIndex > stopIndex);
  const upnpTargetSwitch = outputSwitch.split("if (isUpnpOutput(previousPreference))")[0] ?? "";
  const upnpTargetCommit = upnpTargetSwitch.split("    try {")[1]?.split("    } catch")[0] ?? "";
  assert.match(
    upnpTargetCommit,
    /await stopUpnpOutputForSwitch\(\);[\s\S]*selectUpnpOutput\(deviceId!\)/,
  );
  assert.doesNotMatch(upnpTargetCommit, /releaseUpnpOutput\(\)/);
  const upnpSourceSwitch = outputSwitch.split("if (isUpnpOutput(previousPreference))")[1] ?? "";
  assert.match(
    upnpSourceSwitch,
    /await stopUpnpOutputForSwitch\(\);[\s\S]*syncNativeAlsaModeForTarget\(player, deviceId\);\s*await player\.setOutputDevice[\s\S]*store\.set\("player\.outputDevice", deviceId\);\s*await releaseUpnpOutput\(\)/,
  );
});

test("Core applies pause-on-device-switch policy when restoring playback on the new output", () => {
  assert.match(outputSwitch, /store\.get\("player\.pauseOnDeviceSwitch"\) !== true/);
  assert.match(outputSwitch, /!isLocalDirectOutput\(deviceId\)/);
  assert.match(
    outputSwitch,
    /resolvedOverride: targetResolved,\s*preserveListenBrainzSession: true/,
  );
  assert.match(outputSwitch, /if \(shouldResumePlaying\) await play\(\)/);
});

test("native output selection never owns source reload or resume", () => {
  const nativeSwitch =
    nativeBindingSource.split("pub async fn set_output_device")[1]?.split("/// 获取当前选择的输出设备")[0] ??
    "";
  assert.match(nativeSwitch, /player\.set_output_device\(device_id\)\.into_napi\(\)/);
  assert.doesNotMatch(nativeSwitch, /self\.load\(|self\.seek\(|self\.play\(|pause_immediately/);
});

test("Web Control only sends the output id and never prepares or reloads a source", () => {
  const controlSwitch =
    controlSource.split("export const switchDevice = async (")[1]?.split("/**\n * 设置队列")[0] ??
    "";
  assert.match(controlSwitch, /playerClient\.setOutputDevice\(deviceId\)/);
  assert.doesNotMatch(
    controlSwitch,
    /prepareDirectTrackSource|materializeDirectInput|\.load\(|\.stop\(/,
  );
  assert.doesNotMatch(controlSwitch, /window\.api|ipcRenderer|electron/);
});
