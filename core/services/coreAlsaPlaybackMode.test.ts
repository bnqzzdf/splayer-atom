import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { defaultSystemConfig } from "../../shared/defaults/settings";
import { migrations } from "../store/migrations";

const read = (url: URL): string => readFileSync(url, "utf8");
const session = read(new URL("./playbackSession.ts", import.meta.url));
const routes = read(new URL("../atom/headless/routes.ts", import.meta.url));
const storeSource = read(new URL("../store/index.ts", import.meta.url));
const playerLoad = read(new URL("./playerLoad.ts", import.meta.url));
const preloader = read(new URL("./playbackPreloader.ts", import.meta.url));
const outputStatus = read(new URL("./playerOutputStatus.ts", import.meta.url));
const playerControl = read(new URL("./playerControl.ts", import.meta.url));
const nativeBinding = read(
  new URL("../../native/audio-engine/src/bindings/player.rs", import.meta.url),
);

test("fresh installs default ALSA to direct while schema-v3 upgrades preserve processed behavior", () => {
  assert.equal(defaultSystemConfig.player.alsaPlaybackMode, "direct");
  const v3 = migrations.find((migration) => migration.version === 3);
  assert.ok(v3);
  const upgraded = structuredClone(defaultSystemConfig);
  upgraded.player.outputDevice = "Legacy USB DAC";
  v3.migrate(upgraded);
  assert.equal(upgraded.player.alsaPlaybackMode, "processed");
  assert.equal(upgraded.player.outputDevice, null);
  const canonical = structuredClone(defaultSystemConfig);
  canonical.player.outputDevice = "alsa:hw:CARD=USB_AUDIO,DEV=0";
  v3.migrate(canonical);
  assert.equal(canonical.player.outputDevice, "alsa:hw:CARD=USB_AUDIO,DEV=0");
  assert.match(storeSource, /const freshInstall = Object\.keys\(raw\)\.length === 0/);
  assert.match(
    storeSource,
    /if \(freshInstall\) \{[\s\S]*currentVersion = CONFIG_SCHEMA_VERSION;[\s\S]*\} else \{[\s\S]*m\.migrate\(data\)/,
  );
});

test("Core restores the durable ALSA mode before activating a persisted local output", () => {
  const init = session.split("export const initPlaybackSession = async")[1]?.split("/** 释放 Atom-owned")[0] ?? "";
  const modeIndex = init.indexOf('player.setAlsaPlaybackMode(store.get("player.alsaPlaybackMode"))');
  const outputIndex = init.indexOf("await player.setOutputDevice(output)");
  assert.ok(modeIndex >= 0);
  assert.ok(outputIndex > modeIndex);
});

test("ALSA mode switch rejects Native DSD before releasing the old runtime", () => {
  const flow = session.split("export const setAlsaPlaybackMode = async")[1]?.split("/** 当前 Native")[0] ?? "";
  const dsdGuard = flow.indexOf('targetMode === "processed" && isNativeDsdPlaybackSource');
  const stopIndex = flow.indexOf("player.stop()");
  assert.ok(dsdGuard >= 0);
  assert.ok(stopIndex > dsdGuard);
  assert.match(flow, /Native DSD requires ALSA direct mode/);
});

test("ALSA direct switch prepares remote bytes before stop and commits preference only after reload", () => {
  const flow = session.split("export const setAlsaPlaybackMode = async")[1]?.split("/** 当前 Native")[0] ?? "";
  const materializeIndex = flow.indexOf("materializeDirectInput(resolved.source)");
  const stopIndex = flow.indexOf("player.stop()");
  const nativeModeIndex = flow.indexOf("player.setAlsaPlaybackMode(targetMode)");
  const loadIndex = flow.indexOf("await loadIndex(index, false");
  const storeIndex = flow.lastIndexOf('store.set("player.alsaPlaybackMode", targetMode)');
  assert.ok(materializeIndex >= 0);
  assert.ok(stopIndex > materializeIndex);
  assert.ok(nativeModeIndex > stopIndex);
  assert.ok(loadIndex > nativeModeIndex);
  assert.ok(storeIndex > loadIndex);
  assert.match(flow, /targetMode === "processed" && state === "playing"/);
  assert.doesNotMatch(flow, /targetMode === "direct" && state === "playing"/);
});

test("Direct input and preload policy share the same explicit ALSA mode authority", () => {
  assert.match(playerLoad, /isLocalDirectOutputWithMode\(/);
  assert.match(playerLoad, /inst\.getAlsaPlaybackMode\(\)/);
  assert.match(preloader, /isLocalDirectOutput\(store\.get\("player\.outputDevice"\)\)/);
  assert.match(preloader, /store\.get\("player\.alsaPlaybackMode"\)/);
});

test("Core exposes one ALSA mode command and blocks sample processing while ALSA direct is selected", () => {
  assert.match(routes, /api\.post\("\/player\/alsa-mode"/);
  assert.match(routes, /await setAlsaPlaybackMode\(body\.mode\)/);
  assert.match(routes, /!getPlaybackStatus\(\)\.output\.sampleProcessingAvailable/);
  assert.match(session, /export const assertSampleProcessingAvailable/);
  assert.match(playerControl, /playbackSession\.assertSampleProcessingAvailable\(\)/);
  assert.match(nativeBinding, /pub fn set_alsa_playback_mode/);
  assert.match(nativeBinding, /player\.alsa_direct_selected\(\)/);
});

test("all external sample-processing commands converge on playerControl capability gate", () => {
  for (const method of [
    "setVolume",
    "setSpeed",
    "setPitch",
    "setPitchSync",
    "setNormalizationEnabled",
    "setEqualizerBands",
    "setPreampGain",
    "setEqualizerEnabled",
    "setFadeDuration",
  ]) {
    assert.match(playerControl, new RegExp(`${method}:`));
  }
  assert.doesNotMatch(
    routes,
    /getPlayer\(\)\.set(?:Volume|Speed|Pitch|PitchSync|NormalizationEnabled|EqualizerBands|PreampGain|EqualizerEnabled|FadeDuration)/,
  );
});

test("FFT enable follows the runtime capability without becoming a DSP mode state", () => {
  assert.match(routes, /enabled && !getPlaybackStatus\(\)\.output\.fftAvailable/);
  assert.match(routes, /error: "fft_unavailable"/);
  assert.match(routes, /getPlayer\(\)\.setFftEnabled\(enabled\)/);
  assert.match(outputStatus, /fftAvailable: native\.fftAvailable === true/);
});

test("Direct output projects effective unity controls without overwriting saved processed settings", () => {
  assert.match(outputStatus, /projectNativeEffectiveControls/);
  assert.match(outputStatus, /player\.getAlsaPlaybackMode\(\) === "processed"/);
  assert.doesNotMatch(outputStatus, /@main\/services\/alsaPlaybackMode/);
  assert.match(
    outputStatus,
    /volume: output\.sampleProcessingAvailable \? player\.getVolume\(\) : 1/,
  );
  assert.match(
    outputStatus,
    /speed: output\.sampleProcessingAvailable \? player\.getSpeed\(\) : 1/,
  );
  assert.doesNotMatch(outputStatus, /store\.set|setVolume|setSpeed/);
  assert.match(session, /const controls = projectNativeEffectiveControls\(player\)/);
  assert.match(playerLoad, /const controls = projectNativeEffectiveControls\(inst\)/);
});
