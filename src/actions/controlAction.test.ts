import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const modelSource = readFileSync(new URL("./model.ts", import.meta.url), "utf8");
const trackMenuSource = readFileSync(
  new URL("../composables/useTrackMenu.ts", import.meta.url),
  "utf8",
);
const songListSource = readFileSync(
  new URL("../components/list/SongList.vue", import.meta.url),
  "utf8",
);
const menuAdapterSource = readFileSync(new URL("./menu.ts", import.meta.url), "utf8");
const collectionSource = readFileSync(new URL("../pages/Collection.vue", import.meta.url), "utf8");
const artistSource = readFileSync(new URL("../pages/Artist.vue", import.meta.url), "utf8");
const coverCardSource = readFileSync(
  new URL("../components/list/CoverCard.vue", import.meta.url),
  "utf8",
);
const coverListSource = readFileSync(
  new URL("../components/list/CoverList.vue", import.meta.url),
  "utf8",
);
const favoritesSource = readFileSync(new URL("../pages/Favorites.vue", import.meta.url), "utf8");

test("Control Action Model carries semantic state instead of Dropdown-only flags", () => {
  for (const field of [
    "id: string",
    "label: string",
    "enabled: boolean",
    "visible: boolean",
    "danger: boolean",
    "requiredCapability?: ControlHostCapability",
    "coreCommand?: string",
  ]) {
    assert.match(modelSource, new RegExp(field.replace(/[?]/g, "\\?")));
  }
  assert.match(modelSource, /hasHostCapability\(action\.requiredCapability\)/);
});

test("Track actions declare Core commands and Host requirements once", () => {
  assert.match(trackMenuSource, /const actions = computed<ControlAction\[\]>/);
  assert.match(trackMenuSource, /id: "play"[\s\S]*coreCommand: "player\.playNow"/);
  assert.match(trackMenuSource, /id: "playNext"[\s\S]*coreCommand: "player\.insertQueueNext"/);
  assert.match(trackMenuSource, /id: "download"[\s\S]*coreCommand: "download\.start"/);
  assert.match(
    trackMenuSource,
    /id: "deleteFile"[\s\S]*danger: true[\s\S]*coreCommand: "library\.deleteTracks"/,
  );
  assert.match(trackMenuSource, /id: "comments"[\s\S]*coreCommand: "comments\.get"/);
  assert.match(
    trackMenuSource,
    /id: "showInExplorer"[\s\S]*requiredCapability: "hostFileExplorer"/,
  );
});

test("Track right-click and row more button project the same Action Model", () => {
  assert.match(trackMenuSource, /const items = computed<DropdownMenuItem\[\]>/);
  assert.match(trackMenuSource, /controlActionsToMenuItems\(actions\.value\)/);
  assert.match(songListSource, /<SContextMenu :items="contextMenuItems" @select="onContextMenu">/);
  assert.match(
    songListSource,
    /<SDropdownMenu :items="contextMenuItems" align="end" @select="onContextMenu">/,
  );
  assert.match(songListSource, /@pointerdown\.stop="contextTrack = item"/);
});

test("Track and Collection reuse one Action Model menu adapter", () => {
  assert.match(menuAdapterSource, /export const controlActionToMenuItem/);
  assert.match(menuAdapterSource, /isControlActionVisible\(action\)/);
  assert.match(menuAdapterSource, /action\.children\?\.map\(controlActionToMenuItem\)/);
  assert.match(trackMenuSource, /controlActionsToMenuItems\(actions\.value\)/);
  assert.match(collectionSource, /const collectionActions = computed<ControlAction\[\]>/);
  assert.match(collectionSource, /controlActionsToMenuItems\(/);
  assert.match(collectionSource, /collectionActions\.value\.filter\(/);
});

test("Collection primary and secondary actions share one semantic model", () => {
  assert.match(collectionSource, /id: "playAll"[\s\S]*coreCommand: "player\.playFrom"/);
  assert.match(
    collectionSource,
    /id: "toggleSubscribe"[\s\S]*coreCommand: "provider\.collection\.subscribe"/,
  );
  assert.match(
    collectionSource,
    /id: "edit"[\s\S]*coreCommand: `\$\{manageCommandPrefix\}\.update`/,
  );
  assert.match(
    collectionSource,
    /id: "delete"[\s\S]*danger: true[\s\S]*coreCommand: `\$\{manageCommandPrefix\}\.delete`/,
  );
  assert.match(collectionSource, /@click="handleCollectionAction\('playAll'\)"/);
  assert.match(collectionSource, /@click="handleCollectionAction\('toggleSubscribe'\)"/);
  assert.match(collectionSource, /@select="handleCollectionAction"/);
  assert.match(collectionSource, /manage\.openEdit\(\)/);
  assert.match(collectionSource, /manage\.openDelete\(\)/);
  assert.doesNotMatch(collectionSource, /new .*Collection.*Store|create.*Collection.*Service/);
});

test("Artist primary and overflow actions share one semantic model", () => {
  assert.match(artistSource, /const artistActions = computed<ControlAction\[\]>/);
  assert.match(artistSource, /id: "playAll"[\s\S]*coreCommand: "player\.playFrom"/);
  assert.match(
    artistSource,
    /id: "toggleSubscribe"[\s\S]*coreCommand: "provider\.artist\.subscribe"/,
  );
  assert.match(artistSource, /id: "batchManage"[\s\S]*visible: activeTab\.value === "songs"/);
  assert.match(artistSource, /@click="handleArtistAction\('playAll'\)"/);
  assert.match(artistSource, /@click="handleArtistAction\('toggleSubscribe'\)"/);
  assert.match(artistSource, /@select="handleArtistAction"/);
});

test("Cover cards expose optional Action Model presentation without owning provider semantics", () => {
  assert.match(coverCardSource, /actions\?: ControlAction\[\]/);
  assert.match(coverCardSource, /controlActionsToMenuItems\(props\.actions \?\? \[\]\)/);
  assert.match(coverCardSource, /emit\('action', \$event\)/);
  assert.match(coverListSource, /getActions\?: \(item: CoverItem\) => ControlAction\[\]/);
  assert.match(coverListSource, /@action="emit\('action', \$event, item\)"/);
  assert.doesNotMatch(
    coverCardSource,
    /togglePlaylistSubscribe|toggleAlbumSubscribe|toggleArtistSubscribe/,
  );
});

test("Favorites cards use the shared cover Action Model for unsubscribe", () => {
  assert.match(favoritesSource, /const favoriteActions = \(_item: CoverItem\): ControlAction\[\]/);
  assert.match(favoritesSource, /id: "unsubscribe"/);
  assert.match(favoritesSource, /coreCommand: `provider\.\$\{activeTab\.value\}\.subscribe`/);
  assert.match(favoritesSource, /:get-actions="favoriteActions"/);
  assert.match(favoritesSource, /@action="handleFavoriteAction"/);
  assert.match(favoritesSource, /user\.togglePlaylistSubscribe\(item\.id, false\)/);
  assert.match(favoritesSource, /user\.toggleAlbumSubscribe\(item\.id, false\)/);
  assert.match(favoritesSource, /user\.toggleArtistSubscribe\(item\.id, false\)/);
});
