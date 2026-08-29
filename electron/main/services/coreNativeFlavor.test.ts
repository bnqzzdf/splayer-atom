import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cargoSource = readFileSync(
  new URL("../../../native/audio-engine/Cargo.toml", import.meta.url),
  "utf8",
);
const watcherSource = readFileSync(
  new URL("../../../native/audio-engine/src/device_watcher/mod.rs", import.meta.url),
  "utf8",
);
const buildSource = readFileSync(
  new URL("../../../scripts/atom/build-core-native.ts", import.meta.url),
  "utf8",
);
const coreEntrySource = readFileSync(new URL("../core-node/index.ts", import.meta.url), "utf8");
const nativeLoaderSource = readFileSync(
  new URL("../utils/nativeLoader.ts", import.meta.url),
  "utf8",
);

test("audio-engine keeps Desktop extras behind a Cargo feature", () => {
  assert.match(cargoSource, /default = \["desktop-audio"\]/);
  assert.match(
    cargoSource,
    /desktop-audio = \["cpal\/pipewire", "cpal\/pulseaudio", "dep:pipewire"\]/,
  );
  assert.match(cargoSource, /core-audio = \[\]/);
  assert.match(cargoSource, /cpal = \{ version = "0\.18\.2", default-features = false \}/);
  assert.match(cargoSource, /pipewire = \{[^\n]+optional = true \}/);
});

test("Linux Core disables the PipeWire device watcher", () => {
  assert.match(watcherSource, /all\(target_os = "linux", feature = "desktop-audio"\)/);
  assert.match(watcherSource, /all\(target_os = "linux", not\(feature = "desktop-audio"\)\)/);
});

test("Core native builder emits only the ALSA-only audio-engine addon", () => {
  assert.match(buildSource, /"--no-default-features"/);
  assert.match(buildSource, /"--features",\n {2}"core-audio"/);
  assert.match(buildSource, /out", "core-native"/);
  assert.match(buildSource, /DIRETTA_SDK_ROOT/);
  assert.match(buildSource, /lib\(\?:pipewire\|pulse\)/);
  assert.doesNotMatch(buildSource, /audio-capture|media-ctrl|taskbar-lyric|opencc/);
});

test("Node Core loads native addons from the Core flavor directory", () => {
  assert.match(coreEntrySource, /ATOM_NATIVE_DIR.*\.\.\/core-native/);
  assert.match(nativeLoaderSource, /runtimeEnvironment\.nativeDir/);
  assert.match(nativeLoaderSource, /path\.join\(runtimeEnvironment\.nativeDir, fileName\)/);
});
