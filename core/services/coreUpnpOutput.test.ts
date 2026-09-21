import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

const session = read("core/services/playbackSession.ts");
const routes = read("core/atom/headless/routes.ts");
const outputDevices = read("src/core/outputDevices.ts");
const upnpOutput = read("core/atom/upnp/output.ts");
const upnpMedia = read("core/atom/upnp/media.ts");
const preloader = read("core/services/playbackPreloader.ts");
const sharedPlayer = read("shared/types/player.ts");
const nativePlayer = read("native/audio-engine/src/bindings/player.rs");
const nativeCore = read("native/audio-engine-core/src/lib.rs");
const scannerService = read("core/services/scanner.ts");
const sacdInput = read("core/atom/sacdInput.ts");
const localPhysicalSource = read("core/utils/localPhysicalSource.ts");
const stopUpnpOutput =
  upnpOutput
    .split("export const stopUpnpOutput = async (")[1]
    ?.split("export const seekUpnpOutput")[0] ?? "";

test("UPnP remains an Atom-owned early branch without a generic output framework", () => {
  assert.match(session, /if \(isUpnpSelected\(\)\) \{/);
  assert.match(session, /loadUpnpResolvedTrack/);
  assert.match(session, /loadUpnpFile/);
  assert.doesNotMatch(session, /interface IOutput|class OutputRegistry|class OutputManager/);
});

test("UPnP rejects local sample-processing commands instead of exposing fake controls", () => {
  assert.match(routes, /!getPlaybackStatus\(\)\.output\.sampleProcessingAvailable/);
  assert.match(routes, /getPlaybackStatus\(\)\.volume/);
  assert.match(routes, /output_processing_unavailable/);
  for (const route of [
    "/volume",
    "/player/speed",
    "/player/pitch",
    "/player/pitch-sync",
    "/player/normalization",
    "/player/equalizer",
    "/player/fade",
  ]) {
    const marker = `api.post("${route}", async (c) => {`;
    const section = routes.split(marker)[1]?.slice(0, 280) ?? "";
    assert.match(
      section,
      /sampleProcessingUnavailable\(\)/,
      `${route} must reject unavailable processing`,
    );
  }
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

test("UPnP stop always releases local execution state after a remote failure", () => {
  const commandIndex = stopUpnpOutput.indexOf("await runCommand");
  const finallyIndex = stopUpnpOutput.indexOf("finally");
  const resetIndex = stopUpnpOutput.indexOf('status = { state: "stopped"');
  const releaseIndex = stopUpnpOutput.indexOf("await releaseMediaResource(previous)");
  assert.ok(commandIndex >= 0);
  assert.ok(finallyIndex > commandIndex);
  assert.ok(resetIndex > finallyIndex);
  assert.ok(releaseIndex > resetIndex);
});

test("UPnP online input reuses exact-byte materialization without provider or Direct ownership", () => {
  assert.match(upnpMedia, /materializeUpnpInput/);
  assert.match(upnpMedia, /prepareUpnpPlaybackMedia/);
  assert.match(upnpMedia, /materializeUpnpInput\(resolved\.source\)/);
  assert.match(preloader, /prepareUpnpPlaybackMedia\(item, source\)/);
  const upnpLoad = session
    .split("const loadUpnpResolvedTrack = async (")[1]
    ?.split("const scheduleNextPlaybackPreload")[0];
  assert.ok(upnpLoad);
  assert.doesNotMatch(upnpLoad, /materializeDirectInput/);
  assert.doesNotMatch(upnpLoad, /materializeUpnpInput|extractUpnpCue|extractUpnpSacd/);
  assert.match(upnpLoad, /preparedMedia \?\? \(await prepareUpnpPlaybackMedia\(item, resolved\)\)/);
  assert.match(upnpLoad, /cacheAfterLoad\(media\.filePath\)/);
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
  assert.match(stopBody, /invalidatePlaybackPreload\(\)/);
  assert.match(shutdownBody, /\+\+loadGeneration/);
  assert.match(shutdownBody, /invalidatePlaybackPreload\(\)/);
  assert.match(upnpLoad, /expectedGeneration !== loadGeneration/);
  assert.match(upnpLoad, /await discardPreparedUpnpMedia\(media\)/);
  assert.match(preloader, /token !== preloadToken/);
  assert.match(preloader, /discardPreparedUpnpMedia\(upnpMedia \?\? null\)/);
});

test("UPnP projects quality from the actual local representation", () => {
  assert.match(upnpMedia, /getEngine\(\)\.probeMediaQuality\(filePath\)/);
  assert.match(
    upnpMedia,
    /const quality = \(await probeUpnpMediaQuality\(filePath\)\) \?\? track\.quality/,
  );
  assert.match(session, /quality: media\.quality/);
  assert.match(session, /item\.track = \{ \.\.\.item\.track, quality: mediaInfo\.quality \}/);
  assert.match(session, /quality: mediaInfo\.quality, externalLyrics: \[\]/);
});

test("UPnP next-media preparation stays Core-side and does not touch Renderer transport", () => {
  assert.match(preloader, /startsWith\("upnp:"\)/);
  assert.match(preloader, /prepareUpnpPlaybackMedia\(item, source\)/);
  assert.match(preloader, /upnpMedia\?: PreparedUpnpMedia/);
  assert.match(
    preloader,
    /prepareDirectSource[\s\S]*!isLocalDirectOutput\(store\.get\("player\.outputDevice"\)\)\) return null/,
  );
  assert.doesNotMatch(preloader, /setAvTransportUri|playUpnpOutput|registerMediaFile/);
  assert.doesNotMatch(upnpMedia, /setAvTransportUri|playAvTransport|scanUpnpDevices/);
  assert.doesNotMatch(upnpOutput, /SetNextAVTransportURI|setNextAvTransportUri/);
  assert.match(
    preloader,
    /store\.get\("player\.preloadNextTrack"\) === true \|\|[\s\S]*isLocalDirectOutput\(store\.get\("player\.outputDevice"\)\)/,
  );
  assert.match(preloader, /store\.get\("player\.outputDevice"\) \?\? ""/);
  assert.match(
    preloader,
    /if \(prepared\.key !== key\) \{\s*invalidatePlaybackPreload\(\);\s*return null;/,
  );
  assert.match(upnpMedia, /track\.quality\?\.channels && track\.quality\.channels !== 2/);
  const upnpLoad = session
    .split("const loadUpnpResolvedTrack = async (")[1]
    ?.split("const scheduleNextPlaybackPreload")[0];
  assert.ok(upnpLoad);
  assert.match(
    upnpLoad,
    /catch \(error\) \{\s*await discardPreparedUpnpMedia\(preparedMedia \?\? null\);\s*throw error;/,
  );
});

test("library scanner expands SACD ISO through the Atom-owned sync seam", () => {
  assert.match(scannerService, /getEngine\(\)\.probeSacdTracks\(isoPath\)/);
  assert.match(scannerService, /sacdIsoPathFromVirtual/);
  assert.match(scannerService, /forceProbe: \/\\\.iso\$\/i\.test\(record\.path\)/);
  assert.match(scannerService, /SACD_PLACEHOLDER_TITLE/);
  assert.match(scannerService, /forceProbe: sacdMetadataRefresh\.has\(key\)/);
  assert.match(scannerService, /pendingSacdSyncs/);
  assert.match(sacdInput, /parseSacdVirtualPath/);
  assert.match(localPhysicalSource, /SACD_VIRTUAL_PATH/);
  assert.match(localPhysicalSource, /parseSacdVirtualPath/);
  assert.match(session, /parseSacdPlaybackSource/);
});

test("native SACD streaming does not reuse the UPnP generated media seam", () => {
  assert.doesNotMatch(session, /prepareSacdPlaybackInput|extractSacdDsf\(sacd/);
  assert.match(session, /toNativeSacdPlaybackSource/);
});

test("UPnP CUE and SACD extraction stay behind the Atom media seam", () => {
  const media = read("core/atom/upnp/media.ts");
  const atomExtract = read("native/audio-engine/src/atom_media_extract.rs");
  const coreExtract = read("native/audio-engine-core/src/media_extract.rs");
  assert.match(media, /extractUpnpCueWav\(track\.cuePath, cueNum\)/);
  assert.match(media, /extractUpnpCueDsf\(track\.cuePath, cueNum\)/);
  assert.match(media, /extractUpnpSacdDsf\(sacd\.isoPath, sacd\.trackNum\)/);
  assert.doesNotMatch(session, /extractUpnpCueWav|extractUpnpCueDsf|extractUpnpSacdDsf/);
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
