import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (url: URL): string => readFileSync(url, "utf8");
const controlRoutesSource = read(new URL("../atom/controlRoutes.ts", import.meta.url));
const serverSource = read(new URL("../server/index.ts", import.meta.url));
const libraryStoreSource = read(new URL("../../src/stores/library.ts", import.meta.url));
const tagEditorSource = read(
  new URL("../../src/components/modals/TagEditorDialog.vue", import.meta.url),
);
const searchSource = read(new URL("../../src/pages/Search.vue", import.meta.url));
const quickActionsSource = read(
  new URL("../../src/composables/home/useQuickActions.ts", import.meta.url),
);
const dailySource = read(
  new URL("../../src/composables/home/useDailyRecommend.ts", import.meta.url),
);
const artistLoaderSource = read(new URL("../../src/services/artistLoader.ts", import.meta.url));
const playerSource = read(new URL("../../src/core/player/index.ts", import.meta.url));

test("Node Core mounts one combined Control router", () => {
  assert.match(controlRoutesSource, /buildHeadlessRoutes\(\)/);
  assert.match(controlRoutesSource, /buildAtomCompatRoutes\(\)/);
  assert.match(serverSource, /app\.route\("\/api", buildCoreControlRoutes\(\)\)/);
});

test("active Library requests use the Core client and shared event envelope", () => {
  assert.match(libraryStoreSource, /libraryClient\.getTracks\(\)/);
  assert.match(libraryStoreSource, /libraryClient\.addScanDir\(dir\)/);
  assert.match(libraryStoreSource, /libraryClient\.getLikedTrackIds\(\)/);
  assert.match(libraryStoreSource, /libraryClient\.importLikedTrackIds\(legacyLiked\)/);
  assert.match(libraryStoreSource, /libraryClient\.setTrackLiked\(trackId, liked\)/);
  assert.match(
    libraryStoreSource,
    /subscribeCoreControlEvent\("libraryScanProgress", \(data\) => \{/,
  );
  assert.match(libraryStoreSource, /subscribeCoreControlEvent\("libraryLikesChanged"/);
  assert.doesNotMatch(
    libraryStoreSource,
    /window\.api\.library\.(?:getTracks|getAlbums|getArtists|getAlbumTracks|getArtistTracks|prefetchArtistAvatars|scan|cancelScan|addScanDir|removeScanDir|deleteTracks)/,
  );

  assert.match(tagEditorSource, /libraryClient\.readTags/);
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

  assert.doesNotMatch(libraryStoreSource, /window\.api|pickScanDir/);
  assert.doesNotMatch(tagEditorSource, /window\.api|pickCoverImage/);
});
