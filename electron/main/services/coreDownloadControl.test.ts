import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const managerSource = readFileSync(new URL("./downloadManager.ts", import.meta.url), "utf8");
const resolverSource = readFileSync(
  new URL("./playbackSourceResolver.ts", import.meta.url),
  "utf8",
);
const coreNodeSource = readFileSync(new URL("../core-node/index.ts", import.meta.url), "utf8");
const routesSource = readFileSync(new URL("../atom/headless/routes.ts", import.meta.url), "utf8");
const webApiSource = readFileSync(new URL("../../../src/web/api.ts", import.meta.url), "utf8");
const ipcDownloadSource = readFileSync(new URL("../ipc/download.ts", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../../preload/index.ts", import.meta.url), "utf8");
const downloadTypesSource = readFileSync(
  new URL("../../../shared/types/download.ts", import.meta.url),
  "utf8",
);
const downloadStoreSource = readFileSync(
  new URL("../../../src/stores/download.ts", import.meta.url),
  "utf8",
);
const downloadDirSource = readFileSync(
  new URL("../../../src/components/settings/custom/DownloadDirConfig.vue", import.meta.url),
  "utf8",
);

test("Core download queue resolves sources without a renderer round-trip", () => {
  assert.match(managerSource, /resolveDownloadSource\(/);
  assert.doesNotMatch(managerSource, /broadcast\("download:resolve"/);
  assert.doesNotMatch(managerSource, /waitForResolution|resolutionGates/);
  assert.doesNotMatch(managerSource, /submitResolution|failResolution/);
  assert.doesNotMatch(managerSource, /from "electron"/);
  assert.match(managerSource, /publishDesktopEvent\("download:state"/);
  assert.match(managerSource, /wsBroadcast\(\{ type: "downloadState"/);
  assert.match(managerSource, /export const shutdown/);
});

test("Core download source resolution reuses existing provider and plugin seams", () => {
  const downloadSection = resolverSource.split("export const resolveDownloadSource")[1] ?? "";
  assert.match(downloadSection, /resolveNeteaseDownload\(track, quality, usePlaybackForDownload\)/);
  assert.match(downloadSection, /resolveStreaming\(track, null\)/);
  assert.match(downloadSection, /resolveQobuz\(track, quality, null\)/);
  assert.match(downloadSection, /resolveTidal\(track, quality, null\)/);
  assert.match(downloadSection, /resolvePluginCompatibility\(track, quality, null\)/);
  assert.match(resolverSource, /callNetease\("song_download_url"/);
  assert.match(resolverSource, /callNetease\("song_url"/);
});

test("Node Core owns download lifecycle", () => {
  assert.match(coreNodeSource, /import\("@main\/services\/downloadManager"\)/);
  assert.match(coreNodeSource, /await downloadManager\.init\(\)/);
  assert.match(coreNodeSource, /downloadManager\.shutdown\(\)/);
});

test("Headless Control exposes real Core download queue management", () => {
  for (const route of [
    "/download/tasks",
    "/download/dir",
    "/download/reset-dir",
    "/download/start",
    "/download/start-many",
    "/download/cancel",
    "/download/remove",
    "/download/clear-finished",
  ]) {
    assert.match(routesSource, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(webApiSource, /request<EnqueueResult>\("\/download\/start"/);
  assert.match(webApiSource, /request<DownloadTask\[]>\("\/download\/tasks"\)/);
  assert.match(webApiSource, /event\.type === "downloadProgress"/);
  assert.match(webApiSource, /event\.type === "downloadState"/);
  assert.doesNotMatch(webApiSource, /download:\s*\{\s*list: async \(\) => \[\]/);
});

test("obsolete renderer download-resolution protocol is removed end to end", () => {
  for (const source of [ipcDownloadSource, preloadSource, downloadTypesSource]) {
    assert.doesNotMatch(source, /download:resolve|download:resolution|download:resolveFailed/);
    assert.doesNotMatch(source, /submitResolution|failResolution|onResolve/);
  }
  assert.doesNotMatch(downloadTypesSource, /DownloadResolution|DownloadResolvePayload/);
});

test("Download jobs capture Control lyric preferences before entering Core", () => {
  assert.doesNotMatch(downloadStoreSource, /initDownloadResolver/);
  const composableSource = readFileSync(
    new URL("../../../src/composables/useDownload.ts", import.meta.url),
    "utf8",
  );
  assert.match(composableSource, /prepareDownloadLyrics\(req\)/);
  assert.match(composableSource, /const req = await prepareRequest\(track, opts\)/);
});

test("Web uses the Core directory browser instead of a browser-local picker or explorer", () => {
  assert.match(downloadDirSource, /hasHostCapability\("nativeFileDialogs"\)/);
  assert.match(downloadDirSource, /hasHostCapability\("hostFileExplorer"\)/);
  assert.match(downloadDirSource, /canChangeCoreDir = canBrowseLocalCore \|\| isWebRemote\(\)/);
  assert.match(downloadDirSource, /CoreDirectoryPicker/);
  assert.match(downloadDirSource, /v-if="canOpenLocalCoreDir"/);
  assert.match(webApiSource, /Web Control uses the shared Core directory browser/);
});
