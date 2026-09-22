import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (url: URL): string => readFileSync(url, "utf8");
const preloader = read(new URL("./playbackPreloader.ts", import.meta.url));
const session = read(new URL("./playbackSession.ts", import.meta.url));
const events = read(new URL("./corePlayerEvents.ts", import.meta.url));
const processedGapless = read(new URL("./processedGapless.ts", import.meta.url));
const binding = read(new URL("../../native/audio-engine/src/bindings/player.rs", import.meta.url));
const decoder = read(new URL("../../native/audio-engine-core/src/decoder.rs", import.meta.url));
const writer = read(new URL("../../native/audio-engine-core/src/alsa/processed_pcm.rs", import.meta.url));
const player = read(new URL("../../native/audio-engine-core/src/player/mod.rs", import.meta.url));

test("processed preload stages only optional compatible whole-track PCM and never blocks full load", () => {
  assert.match(preloader, /isAlsaProcessedOutput\(store\.get\("player\.outputDevice"\)\)/);
  assert.match(preloader, /store\.get\("player\.preloadNextTrack"\) !== true/);
  assert.match(preloader, /track\.cueStartFrame75 != null/);
  assert.match(preloader, /toNativeSacdPlaybackSource\(/);
  assert.match(preloader, /stageProcessedPlaybackNext\(prepared\.processedSource, generation\)/);
  assert.match(preloader, /resolved\.cacheAfterLoad \? await resolved\.cacheAfterLoad\(\) : null/);
  assert.match(preloader, /materializeDirectInput\(resolved\.source\)/);
  assert.match(preloader, /waitForPlaybackPreloadIdle = \(\): Promise<void> => directStageChain/);
  assert.doesNotMatch(preloader, /processedStageChain/);
});

test("processed staging uses one decoder slot and rejects stale async prepare", () => {
  assert.match(binding, /pub async fn stage_processed_next/);
  assert.match(binding, /stage_handle\.begin_stage\(\)/);
  assert.match(binding, /stage_handle\.stage_if_current\(epoch, staged\)/);
  assert.match(decoder, /struct ProcessedStageState/);
  assert.match(decoder, /slot: Mutex<Option<StagedProcessedDecoder>>/);
  assert.match(decoder, /processed gapless 下一音源声道数变化需要重新协商输出/);
  assert.match(player, /processed_gapless_staging_allowed/);
  assert.match(player, /tempo\.lock\(\)\.is_bypass\(\)/);
  assert.match(player, /if !bypass \{[\s\S]*stage\.cancel\(\)/);
});

test("processed boundary is committed only from DAC-side played timeline", () => {
  assert.match(writer, /PendingTrackBoundary/);
  assert.match(writer, /commit_track_boundaries_by_frame/);
  assert.match(writer, /shared\.commit_track_boundary/);
  assert.match(events, /case "processedTrackBoundary"/);
  assert.match(session, /consumeProcessedPlaybackBoundary\(generation, queue\)/);
  assert.match(session, /commitProcessedPlaybackBoundary\(/);
  assert.match(session, /commitGaplessSessionProjection\(/);
});

test("processed gapless boundary updates source and statistics without creating a second runtime", () => {
  assert.match(processedGapless, /commitProcessedGaplessBoundary/);
  assert.match(processedGapless, /beginCorePlayStats/);
  assert.match(processedGapless, /neteaseScrobble\.onTrackLoaded/);
  assert.match(processedGapless, /listenbrainz\.onTrackLoaded/);
  assert.doesNotMatch(processedGapless, /new AudioPlayer|AudioOutput|OutputRegistry/);
});

test("processed gapless preserves staged media metadata for lightweight local queue Tracks", () => {
  assert.match(processedGapless, /mediaInfo: localMediaInfoFromNativeMetadata\(meta\)/);
  assert.match(preloader, /processedMediaInfo: prepared\.processedMediaInfo/);
  assert.match(
    session,
    /enrichLocalTrackFromMediaInfo\(prepared\.item\.track, prepared\.processedMediaInfo\)/,
  );
});
