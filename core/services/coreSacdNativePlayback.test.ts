import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (file: string): string => readFileSync(resolve(process.cwd(), file), "utf8");
const session = read("core/services/playbackSession.ts");
const preloader = read("core/services/playbackPreloader.ts");
const sacdInput = read("core/atom/sacdInput.ts");
const decoder = read("native/audio-engine-core/src/decoder.rs");
const mediaProbe = read("native/audio-engine-core/src/media_probe.rs");
const directDsd = read("native/audio-engine-core/src/direct_dsd.rs");
const directRuntime = read("native/audio-engine-core/src/direct_runtime.rs");
const virtualDsf = read("native/audio-engine-core/src/sacd/virtual_dsf.rs");

test("SACD playback presentation keeps logical DSD clock instead of FFmpeg packed-byte metadata", () => {
  assert.match(session, /quality\.bitsPerSample !== 1/);
  assert.match(session, /quality\.sampleRate < 2_822_400/);
  assert.match(session, /projectLogicalDsdPlaybackMetadata\(item\.track, detail, mediaInfo\)/);
  assert.match(session, /detail: projected\.detail/);
  assert.match(session, /mediaInfo: projected\.mediaInfo/);
});

test("ALSA streams SACD virtual tracks through a lazy seekable DSF view", () => {
  assert.match(sacdInput, /toNativeSacdPlaybackSource/);
  assert.doesNotMatch(sacdInput, /extractSacdDsf|mkdtemp|\.dsf\.part/);
  assert.match(
    session,
    /toNativeSacdPlaybackSource\(resolved\.source, track\.track, track\.duration\)/,
  );
  assert.match(session, /loadPlayerSource\(\s*nativeSource/);
  assert.match(mediaProbe, /SacdDsfStream::open_virtual_path\(source\)/);
  assert.doesNotMatch(decoder, /SacdDsfStream::open_virtual_path\(source\)/);
  assert.match(virtualDsf, /impl Read for SacdDsfStream/);
  assert.match(virtualDsf, /impl Seek for SacdDsfStream/);
});

test("Diretta opens and stages the same SACD virtual DSD stream without materializing a file", () => {
  assert.match(
    preloader,
    /toNativeSacdPlaybackSource\(resolved\.source, track\.track, track\.duration\)/,
  );
  assert.match(preloader, /stageDirectPlaybackNext\(\s*directSource,/);
  assert.doesNotMatch(preloader, /prepareSacdPlaybackInput|extractSacdDsf/);
  assert.match(directRuntime, /parse_sacd_virtual_path\(source\)/);
  assert.match(directDsd, /SacdDsfStream::open_virtual_path\(source\)/);
});

test("terminal commands invalidate Direct staging without owning generated SACD files", () => {
  assert.match(
    session,
    /export const stop = \(\): void => \{[\s\S]*?invalidatePlaybackPreload\(\);[\s\S]*?stopCurrentOutputBestEffort\(\)/,
  );
  assert.match(
    session,
    /export const shutdownPlaybackSession = async \(\): Promise<void> => \{[\s\S]*?invalidatePlaybackPreload\(\);/,
  );
  assert.doesNotMatch(session, /cleanupSacdPlaybackInputs|pruneSacdPlaybackInputs/);
});
