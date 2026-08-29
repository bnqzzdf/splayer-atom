import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (url: URL): string => readFileSync(url, "utf8");
const controlRoutesSource = read(new URL("../atom/controlRoutes.ts", import.meta.url));
const controlProtocolSource = read(new URL("../atom/controlProtocol.ts", import.meta.url));
const serverSource = read(new URL("../server/index.ts", import.meta.url));
const libraryIpcSource = read(new URL("../ipc/library.ts", import.meta.url));
const preloadSource = read(new URL("../../preload/index.ts", import.meta.url));
const webApiSource = read(new URL("../../../src/web/api.ts", import.meta.url));
const libraryStoreSource = read(new URL("../../../src/stores/library.ts", import.meta.url));
const tagEditorSource = read(
  new URL("../../../src/components/modals/TagEditorDialog.vue", import.meta.url),
);
const searchSource = read(new URL("../../../src/pages/Search.vue", import.meta.url));
const quickActionsSource = read(
  new URL("../../../src/composables/home/useQuickActions.ts", import.meta.url),
);
const dailySource = read(
  new URL("../../../src/composables/home/useDailyRecommend.ts", import.meta.url),
);
const artistLoaderSource = read(new URL("../../../src/services/artistLoader.ts", import.meta.url));
const playerSource = read(new URL("../../../src/core/player/index.ts", import.meta.url));

const section = (source: string, start: string, end: string): string => {
  const afterStart = source.split(start)[1];
  assert.ok(afterStart, `missing start marker: ${start}`);
  const value = afterStart.split(end)[0];
  assert.ok(value, `missing end marker: ${end}`);
  return value;
};

test("Desktop and Headless Web mount one combined Core Control router", () => {
  assert.match(controlRoutesSource, /buildHeadlessRoutes\(\)/);
  assert.match(controlRoutesSource, /buildAtomCompatRoutes\(\)/);
  assert.match(controlProtocolSource, /const routes = buildCoreControlRoutes\(\)/);
  assert.match(serverSource, /app\.route\("\/api", buildCoreControlRoutes\(\)\)/);
});

test("active Library requests use the shared Core client while Host and event seams stay explicit", () => {
  assert.match(libraryStoreSource, /libraryClient\.getTracks\(\)/);
  assert.match(libraryStoreSource, /libraryClient\.addScanDir\(dir\)/);
  assert.match(libraryStoreSource, /window\.api\.library\.pickScanDir\(\)/);
  assert.match(
    libraryStoreSource,
    /subscribeCoreControlEvent\("libraryScanProgress", \(data\) => \{/,
  );
  assert.doesNotMatch(
    libraryStoreSource,
    /window\.api\.library\.(?:getTracks|getAlbums|getArtists|getAlbumTracks|getArtistTracks|prefetchArtistAvatars|scan|cancelScan|addScanDir|removeScanDir|deleteTracks)/,
  );

  assert.match(tagEditorSource, /libraryClient\.readTags/);
  assert.match(tagEditorSource, /window\.api\.library\.pickCoverImage\(\)/);
  for (const source of [
    searchSource,
    quickActionsSource,
    dailySource,
    artistLoaderSource,
    playerSource,
  ]) {
    assert.match(source, /libraryClient\./);
    assert.doesNotMatch(source, /window\.api\.library\./);
  }

  assert.match(webApiSource, /\.\.\.libraryClient/);
  assert.match(webApiSource, /pickScanDir: async \(\) => \(\{ success: false/);
});

test("Desktop scan-directory picker is Host-only and does not mutate Library state", () => {
  const picker = section(
    libraryIpcSource,
    'ipcMain.handle("library:pickScanDir"',
    "// 移除扫描目录及其下所有曲目",
  );
  assert.match(picker, /dialog\.showOpenDialog/);
  assert.match(picker, /resolveCoreDirectory/);
  assert.doesNotMatch(picker, /store\.set|deleteTracksByDir|startScan/);
  assert.match(preloadSource, /pickScanDir: \(\) => ipcRenderer\.invoke\("library:pickScanDir"\)/);
});
