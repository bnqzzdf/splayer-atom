import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const foldersSource = readFileSync(new URL("./Folders.vue", import.meta.url), "utf8");
const folderClientSource = readFileSync(
  new URL("../core/folderBrowserClient.ts", import.meta.url),
  "utf8",
);
const trackMenuSource = readFileSync(
  new URL("../composables/useTrackMenu.ts", import.meta.url),
  "utf8",
);
const queuePopoverSource = readFileSync(
  new URL("../components/list/QueuePopover.vue", import.meta.url),
  "utf8",
);
const queuePanelSource = readFileSync(
  new URL("../components/player/FullPlayer/QueuePanel.vue", import.meta.url),
  "utf8",
);
const fullPlayerSource = readFileSync(
  new URL("../components/player/FullPlayer/index.vue", import.meta.url),
  "utf8",
);
const zhSource = readFileSync(new URL("../i18n/locales/zh-CN.json", import.meta.url), "utf8");

test("Folder filter stays separate from recursive Folder Search", () => {
  assert.ok(foldersSource.includes('v-if="!currentPath"'));
  assert.ok(foldersSource.includes('v-model="searchQuery"'));
  assert.ok(foldersSource.includes('v-model="filterQuery"'));
  assert.ok(foldersSource.includes("folderFilters = new Map<string, string>()"));
  assert.ok(foldersSource.includes("activeFilter || undefined"));
  assert.ok(folderClientSource.includes('if (filter) params.set("filter", filter)'));
});

test("Folder actions use concise recursive menu with one current-folder-only submenu", () => {
  assert.ok(foldersSource.includes('key: "currentOnly"'));
  assert.ok(foldersSource.includes('label: t("folder.addToPlaylist")'));
  for (const stale of [
    't("folder.playCurrentOnly")',
    't("folder.playNextCurrentOnly")',
    't("folder.queueCurrentOnly")',
    't("folder.playlistCurrentOnly")',
    'label: t("common.play")',
  ]) {
    assert.equal(foldersSource.includes(stale), false);
  }
  assert.equal(zhSource.includes("下一首播放"), false);
});

test("Folder presentation supports list/grid without changing route semantics", () => {
  assert.ok(foldersSource.includes('folderViewMode = ref<"list" | "grid">("list")'));
  assert.ok(foldersSource.includes("atom-folder-view-mode"));
  assert.ok(foldersSource.includes('kind: "directory-grid"'));
  assert.ok(foldersSource.includes("directoryThumbnailUrl(entry.path)"));
  assert.ok(foldersSource.includes('class="absolute right-2 top-2"'));
  assert.equal(foldersSource.includes('class="absolute right-2 top-2 opacity-90"'), false);
});

test("Folder container splits can be added individually to an existing or new playlist", () => {
  assert.ok(foldersSource.includes("openContainerTrackPlaylist(item.track, item.containerPath)"));
  assert.ok(foldersSource.includes("folderBrowserClient.addContainerTrackToPlaylist("));
  assert.ok(foldersSource.includes("trackTarget.trackId"));
  assert.ok(folderClientSource.includes('"/library/folders/playlist-track"'));
  assert.ok(foldersSource.includes("createTargetTrack?.title"));
});

test("Folder batch management keeps explicit file selection Core-owned", () => {
  assert.ok(foldersSource.includes('key: "batchManage"'));
  assert.ok(foldersSource.includes("batchSelectedTargets"));
  assert.ok(foldersSource.includes("folderBrowserClient.batchPlay(mode, targets)"));
  assert.ok(
    foldersSource.includes("folderBrowserClient.addBatchToPlaylist(playlistId, batchTargets)"),
  );
  assert.ok(foldersSource.includes("item.entry.kind !== 'directory'"));
  assert.ok(foldersSource.includes("item.entry.kind !== 'material'"));
  assert.ok(folderClientSource.includes('"/library/folders/batch/playlist"'));
  assert.ok(folderClientSource.includes("/library/folders/batch/"));
});

test("Show in folder remains shared across player and queue surfaces", () => {
  assert.ok(trackMenuSource.includes('id: "openContainingFolder"'));
  assert.ok(trackMenuSource.includes("folderBrowserClient.location(current)"));
  assert.ok(queuePopoverSource.includes("onOpenContainingFolder(item)"));
  assert.ok(queuePopoverSource.includes("openContainingFolder(track)"));
  assert.ok(queuePanelSource.includes("onOpenContainingFolder(item)"));
  assert.ok(queuePanelSource.includes("openContainingFolder(track)"));
  assert.ok(fullPlayerSource.includes("openDisplayTrackContainingFolderAction()"));
  assert.ok(fullPlayerSource.includes("collapse()"));
});
