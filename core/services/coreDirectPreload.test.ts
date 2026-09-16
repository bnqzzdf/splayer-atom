import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

const preloader = read("core/services/playbackPreloader.ts");
const session = read("core/services/playbackSession.ts");
const coreEvents = read("core/services/corePlayerEvents.ts");
const webEvents = read("src/core/player/events.ts");
const nativePlayer = read("native/audio-engine-core/src/player/mod.rs");
const directPcm = read("native/audio-engine-core/src/direct_pcm.rs");
const directDsd = read("native/audio-engine-core/src/direct_dsd.rs");
const nativeBinding = read("native/audio-engine/src/bindings/player.rs");

test("Core preload prepares Diretta input and stages through the shared main service", () => {
  assert.match(preloader, /stageDirectPlaybackNext/);
  assert.match(preloader, /materializeDirectInput/);
  assert.match(preloader, /resolved\.cacheAfterLoad \? await resolved\.cacheAfterLoad\(\) : null/);
  assert.match(preloader, /store\.get\("player\.outputDevice"\)\?\.startsWith\("diretta:"\)/);
  assert.doesNotMatch(preloader, /getSelectedDeviceName\(\)/);
  assert.doesNotMatch(preloader, /window\.api/);
});

test("Diretta staging remains active when generic next-track preload is disabled", () => {
  assert.match(
    preloader,
    /store\.get\("player\.preloadNextTrack"\) === true \|\|[\s\S]*store\.get\("player\.outputDevice"\)\?\.startsWith\("diretta:"\) === true/,
  );
  assert.equal(preloader.match(/if \(!shouldPrepareNextInput\(\)\)/g)?.length, 2);
});

test("preload invalidation cancels native staging immediately without touching the active producer", () => {
  assert.match(preloader, /const cancelDirectStageNow = \(\): void =>/);
  assert.match(preloader, /cancelDirectPlaybackNext\(\)/);
  assert.match(
    preloader,
    /const clearPrepared = [\s\S]*if \(cleanupOwned\) \{\s*cancelDirectStageNow\(\);/,
  );
  assert.doesNotMatch(preloader, /queueDirectCleanup\([^)]*cancelStaged/);
});

test("queue edits never run next-source preparation on the active Direct producer", () => {
  const pcmProducer = directPcm
    .split('.name("diretta-direct-decode".into())')[1]
    ?.split('.context("启动 Source Direct decoder producer 失败")')[0];
  const dsdProducer = directDsd
    .split('.name("diretta-direct-dsd".into())')[1]
    ?.split('.context("启动 Native DSD producer 失败")')[0];
  assert.ok(pcmProducer, "PCM Direct producer should exist");
  assert.ok(dsdProducer, "DSD Direct producer should exist");

  assert.doesNotMatch(directPcm, /StageLocal|CancelStaged/);
  assert.doesNotMatch(directDsd, /StageLocal|CancelStaged/);
  assert.doesNotMatch(pcmProducer, /prepare_staged_pcm_source/);
  assert.doesNotMatch(dsdProducer, /prepare_staged_dsd_source/);
  assert.match(directPcm, /struct DirectPcmStaging[\s\S]*candidate: Mutex/);
  assert.match(directDsd, /struct DirectDsdStaging[\s\S]*candidate: Mutex/);
  assert.match(pcmProducer, /producer_ring\.finished[\s\S]*producer_staging\.take_current\(\)/);
  assert.match(dsdProducer, /producer_ring\.finished[\s\S]*producer_staging\.take_current\(\)/);
  assert.match(
    nativeBinding,
    /spawn_blocking\(move \|\| \{\s*handle\.stage_local\([\s\S]*&source,[\s\S]*duration_secs,[\s\S]*u64::from\(generation\),[\s\S]*cue_start_frame75\.map\(u64::from\),[\s\S]*cue_end_frame75\.map\(u64::from\)/,
  );
});

test("Node Core consumes Direct boundary into the authoritative session", () => {
  assert.match(coreEvents, /playbackSession\.onNativeDirectTrackBoundary\(generation, duration\)/);
  assert.match(session, /consumeDirectPlaybackBoundary\(generation, queue\)/);
  assert.match(session, /commitDirectPlaybackBoundary/);
  assert.match(session, /scheduleNextPlaybackPreload\(\)/);
});

test("Direct gapless boundary invalidates the previous raw cover", () => {
  const boundary = nativePlayer
    .split("pub fn commit_direct_gapless_boundary")[1]
    ?.split("pub fn validate_direct_entry")[0];
  assert.ok(boundary, "Direct gapless boundary implementation should exist");
  assert.match(
    boundary,
    /playback\.commit_gapless_boundary\([\s\S]*source,[\s\S]*duration,[\s\S]*cue_start_frame75,[\s\S]*cue_end_frame75/,
  );
  assert.match(boundary, /self\.cover_raw = None/);
  assert.ok(boundary.indexOf("self.cover_raw = None") < boundary.indexOf("self.current_source"));
});

test("Web Control has no Direct recovery fallback state machine", () => {
  assert.doesNotMatch(webEvents, /directTrackBoundary|sourceError|recoverFromSourceFailure/);
  assert.match(coreEvents, /playbackSession\.onNativeSourceError\(\)/);
});
