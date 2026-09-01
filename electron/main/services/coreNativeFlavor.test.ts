import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DIRETTA_SDK_RELEASE, readDirettaSdkRelease } from "../../../scripts/atom/diretta-sdk";

const shimCargoSource = readFileSync(
  new URL("../../../native/audio-engine/Cargo.toml", import.meta.url),
  "utf8",
);
const coreCargoSource = readFileSync(
  new URL("../../../native/audio-engine-core/Cargo.toml", import.meta.url),
  "utf8",
);
const watcherSource = readFileSync(
  new URL("../../../native/audio-engine-core/src/device_watcher/mod.rs", import.meta.url),
  "utf8",
);
const buildSource = readFileSync(
  new URL("../../../scripts/atom/build-core-native.ts", import.meta.url),
  "utf8",
);
const direttaBuildSource = readFileSync(
  new URL("../../../native/diretta-sys/build.rs", import.meta.url),
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

test("audio-engine keeps Desktop extras behind the shared Core Cargo feature", () => {
  assert.match(shimCargoSource, /default = \["desktop-audio"\]/);
  assert.match(shimCargoSource, /"audio-engine-core\/desktop-audio"/);
  assert.match(
    shimCargoSource,
    /core-audio = \["audio-engine-core\/fft", "audio-engine-core\/midi"\]/,
  );
  assert.match(
    shimCargoSource,
    /audio-engine-core = \{ path = "\.\.\/audio-engine-core", default-features = false/,
  );
  assert.match(coreCargoSource, /default = \["fft", "midi", "desktop-audio"\]/);
  assert.match(
    coreCargoSource,
    /desktop-audio = \["cpal\/pipewire", "cpal\/pulseaudio", "dep:pipewire"\]/,
  );
  assert.match(coreCargoSource, /diretta = \["dep:diretta-sys"\]/);
  assert.match(shimCargoSource, /diretta = \["audio-engine-core\/diretta"\]/);
  assert.match(coreCargoSource, /cpal = \{ version = "0\.18\.2", default-features = false \}/);
  assert.match(coreCargoSource, /pipewire = \{[^\n]+optional = true \}/);
});

test("Linux Core disables the PipeWire device watcher", () => {
  assert.match(watcherSource, /all\(target_os = "linux", feature = "desktop-audio"\)/);
  assert.match(watcherSource, /all\(target_os = "linux", not\(feature = "desktop-audio"\)\)/);
});

test("Core native builder emits only the required audio and streaming addons", () => {
  assert.match(buildSource, /"--no-default-features"/);
  assert.match(buildSource, /const audioFeatures = direttaSdkRoot \? "core-audio,diretta" : "core-audio"/);
  assert.match(buildSource, /streaming-api \(Qobuz\/TIDAL\)/);
  assert.match(buildSource, /modules: \["audio-engine", "streaming-api"\]/);
  assert.match(buildSource, /audio-engine\.node/);
  assert.match(buildSource, /streaming-api\.node/);
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
  assert.equal(DIRETTA_SDK_RELEASE, 150);
  const sdkRoot = mkdtempSync(path.join(tmpdir(), "atom-diretta-sdk-"));
  try {
    mkdirSync(path.join(sdkRoot, "Host"));
    writeFileSync(
      path.join(sdkRoot, "Host", "Release.hpp"),
      "namespace DIRETTA { static constexpr unsigned ReleaseNo = 150; }\n",
    );
    assert.equal(readDirettaSdkRelease(sdkRoot), DIRETTA_SDK_RELEASE);
  } finally {
    rmSync(sdkRoot, { recursive: true, force: true });
  }
  assert.match(buildSource, /requireDiretta && !direttaSdkRoot/);
  assert.match(buildSource, /direttaSdkRelease !== DIRETTA_SDK_RELEASE/);
  assert.match(buildSource, /Core Diretta 构建固定使用 SDK/);
  assert.match(direttaBuildSource, /-print-file-name=libstdc\+\+\.a/);
  assert.match(direttaBuildSource, /rustc-link-lib=static=stdc\+\+/);
  assert.doesNotMatch(direttaBuildSource, /rustc-link-lib=dylib=stdc\+\+/);
});

test("Core system staging refuses debug or mismatched native addons", () => {
  assert.match(stageSource, /nativeBuild\.profile !== "release"/);
  assert.match(stageSource, /streaming-api\.node/);
  assert.match(stageSource, /callStreamingProvider/);
  assert.match(stageSource, /nativeBuild\.flavor !== "core-audio"/);
  assert.match(stageSource, /nativeBuild\.direttaSdkRelease !== DIRETTA_SDK_RELEASE/);
  assert.match(stageSource, /no-Diretta Core native metadata 不应携带 SDK release/);
});

test("Node Core loads native addons from the Core flavor directory", () => {
  assert.match(coreEntrySource, /ATOM_NATIVE_DIR.*\.\.\/native/);
  assert.match(nativeLoaderSource, /runtimeEnvironment\.nativeDir/);
  assert.match(nativeLoaderSource, /path\.join\(runtimeEnvironment\.nativeDir, fileName\)/);
});
