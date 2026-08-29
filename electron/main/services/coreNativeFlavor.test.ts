import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DIRETTA_SDK_RELEASE, readDirettaSdkRelease } from "../../../scripts/atom/diretta-sdk";

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
const stageSource = readFileSync(
  new URL("../../../scripts/atom/stage-core-system.ts", import.meta.url),
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
  assert.match(buildSource, /out", "native"/);
  assert.match(buildSource, /DIRETTA_SDK_ROOT/);
  assert.match(buildSource, /CARGO_HOME/);
  assert.match(buildSource, /build\.json/);
  assert.match(buildSource, /profile: isDev \? "debug" : "release"/);
  assert.match(buildSource, /direttaSdkRelease/);
  assert.match(buildSource, /lib\(\?:pipewire\|pulse\)/);
  assert.doesNotMatch(buildSource, /audio-capture|media-ctrl|taskbar-lyric|opencc/);
});

test("Core Diretta build pins the verified SDK release from Release.hpp", () => {
  assert.equal(DIRETTA_SDK_RELEASE, 149);
  const sdkRoot = mkdtempSync(path.join(tmpdir(), "atom-diretta-sdk-"));
  try {
    mkdirSync(path.join(sdkRoot, "Host"));
    writeFileSync(
      path.join(sdkRoot, "Host", "Release.hpp"),
      "namespace DIRETTA { static constexpr unsigned ReleaseNo = 149; }\n",
    );
    assert.equal(readDirettaSdkRelease(sdkRoot), DIRETTA_SDK_RELEASE);
  } finally {
    rmSync(sdkRoot, { recursive: true, force: true });
  }
  assert.match(buildSource, /requireDiretta && !direttaSdkRoot/);
  assert.match(buildSource, /direttaSdkRelease !== DIRETTA_SDK_RELEASE/);
  assert.match(buildSource, /Core Diretta 构建固定使用 SDK/);
});

test("Core system staging refuses debug or mismatched Diretta native addons", () => {
  assert.match(stageSource, /nativeBuild\.profile !== "release"/);
  assert.match(stageSource, /nativeBuild\.flavor !== "core-audio"/);
  assert.match(stageSource, /nativeBuild\.direttaSdkRelease !== DIRETTA_SDK_RELEASE/);
  assert.match(stageSource, /no-Diretta Core native metadata 不应携带 SDK release/);
});

test("Node Core loads native addons from the Core flavor directory", () => {
  assert.match(coreEntrySource, /ATOM_NATIVE_DIR.*\.\.\/native/);
  assert.match(nativeLoaderSource, /runtimeEnvironment\.nativeDir/);
  assert.match(nativeLoaderSource, /path\.join\(runtimeEnvironment\.nativeDir, fileName\)/);
});
