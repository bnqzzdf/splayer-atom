import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

const session = read("electron/main/services/playbackSession.ts");
const routes = read("electron/main/atom/headless/routes.ts");
const outputDevices = read("src/core/outputDevices.ts");
const upnpOutput = read("electron/main/atom/upnp/output.ts");
const upnpMedia = read("electron/main/atom/upnp/media.ts");
const sharedPlayer = read("shared/types/player.ts");
const nativePlayer = read("native/audio-engine/src/bindings/player.rs");
const nativeCore = read("native/audio-engine-core/src/lib.rs");

test("UPnP remains an Atom-owned early branch without a generic output framework", () => {
  assert.match(session, /if \(isUpnpSelected\(\)\) \{/);
  assert.match(session, /loadUpnpResolvedTrack/);
  assert.match(session, /loadUpnpFile/);
  assert.doesNotMatch(session, /interface IOutput|class OutputRegistry|class OutputManager/);
});

test("UPnP reuses the existing output and status Core Protocol schema", () => {
  assert.match(routes, /scanUpnpOutputDevices\(\)/);
  assert.match(routes, /getPlaybackStatus\(\)/);
  assert.match(outputDevices, /startsWith\("upnp:"\)/);
  assert.doesNotMatch(sharedPlayer, /kind\?: "upnp"|availability\?:|canSeek\?:|canPause\?:/);
  assert.match(sharedPlayer, /volume: number;/);
});

test("basic UPnP output does not modify the native AudioPlayer surface", () => {
  assert.doesNotMatch(nativePlayer, /upnp/i);
  assert.doesNotMatch(nativeCore, /upnp/i);
});

test("UPnP P2 keeps renderer observations and output switching inside existing Core authority", () => {
  assert.match(upnpOutput, /const runCommand = <T>/);
  assert.match(upnpOutput, /setUpnpOutputObserver/);
  assert.match(session, /handleUpnpObservation/);
  assert.match(session, /upnpSeenPlaying/);
  assert.match(session, /isNearUpnpEnd/);
  assert.match(session, /prepareUpnpOutput\(deviceId!\)/);
  assert.doesNotMatch(session, /切换到 UPnP 将在 P2 实现|从 UPnP 切换输出将在 P2 实现/);
});

test("UPnP online input reuses exact-byte materialization without provider or Direct ownership", () => {
  assert.match(upnpMedia, /materializeUpnpInput/);
  assert.match(session, /materializeUpnpInput\(resolved\.source\)/);
  assert.match(session, /cacheAfterLoad\(temporaryInput\)/);
  const upnpLoad = session
    .split("const loadUpnpResolvedTrack = async (")[1]
    ?.split("const scheduleNextPlaybackPreload")[0];
  assert.ok(upnpLoad);
  assert.doesNotMatch(upnpLoad, /materializeDirectInput/);
});

test("terminal Core commands invalidate pending slow UPnP media preparation", () => {
  const stopBody = session.split("export const stop = (): void => {")[1]?.split("};")[0];
  const shutdownBody = session
    .split("export const shutdownPlaybackSession = async (): Promise<void> => {")[1]
    ?.split("};")[0];
  const upnpLoad = session
    .split("const loadUpnpResolvedTrack = async (")[1]
    ?.split("const scheduleNextPlaybackPreload")[0];
  assert.ok(stopBody);
  assert.ok(shutdownBody);
  assert.ok(upnpLoad);
  assert.match(stopBody, /\+\+loadGeneration/);
  assert.match(shutdownBody, /\+\+loadGeneration/);
  assert.match(upnpLoad, /expectedGeneration !== loadGeneration/);
  assert.match(upnpLoad, /await discardUpnpInput\(temporaryInput\)/);
});

test("UPnP projects quality from the actual local representation", () => {
  assert.match(upnpMedia, /getEngine\(\)\.probeMediaQuality\(filePath\)/);
  assert.match(session, /probeUpnpMediaQuality\(filePath\)/);
  assert.match(session, /item\.track = \{ \.\.\.item\.track, quality: mediaInfo\.quality \}/);
  assert.match(session, /quality: mediaInfo\.quality, externalLyrics: \[\]/);
});

test("UPnP CUE and SACD extraction stay behind the Atom media seam", () => {
  const media = read("electron/main/atom/upnp/media.ts");
  const atomExtract = read("native/audio-engine/src/atom_media_extract.rs");
  const coreExtract = read("native/audio-engine-core/src/media_extract.rs");
  assert.match(session, /extractUpnpCueWav\(track\.cuePath, cueNum\)/);
  assert.match(session, /extractUpnpCueDsf\(track\.cuePath, cueNum\)/);
  assert.match(session, /extractUpnpSacdDsf\(sacd\.isoPath, sacd\.trackNum\)/);
  assert.match(media, /getEngine\(\)\.extractCueWav/);
  assert.match(media, /getEngine\(\)\.extractCueDsf/);
  assert.match(media, /getEngine\(\)\.extractSacdDsf/);
  assert.match(atomExtract, /audio_engine_core::media_extract::extract_cue_track_to_wav/);
  assert.match(atomExtract, /audio_engine_core::media_extract::extract_cue_track_to_dsf/);
  assert.match(atomExtract, /audio_engine_core::media_extract::extract_sacd_track_to_dsf/);
  assert.match(coreExtract, /DirectPcmDecoder::open_local/);
  assert.match(coreExtract, /SacdTrackReader::open_track/);
  assert.doesNotMatch(session, /extractUpnpCueDff|extractUpnpSacdDff/);
  assert.doesNotMatch(nativePlayer, /extractCueWav|extractCueDsf|extractSacdDsf|media_extract/i);
});
