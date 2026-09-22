import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serviceSource = readFileSync(new URL("./libraryFiles.ts", import.meta.url), "utf8");
const routesSource = readFileSync(new URL("../atom/compat/routes.ts", import.meta.url), "utf8");
const libraryClientSource = readFileSync(
  new URL("../../src/core/libraryClient.ts", import.meta.url),
  "utf8",
);
const libraryTypesSource = readFileSync(
  new URL("../../shared/types/library.ts", import.meta.url),
  "utf8",
);
const tagEditorSource = readFileSync(
  new URL("../../src/components/modals/TagEditorDialog.vue", import.meta.url),
  "utf8",
);

test("Core library file service stays Electron-free and only exposes tag mutation", () => {
  assert.doesNotMatch(serviceSource, /from "electron"/);
  assert.match(serviceSource, /getAllTracks\(\)/);
  assert.match(serviceSource, /assertKnownLibraryPath\(filePath\)/);
  assert.match(serviceSource, /edits\.some\(\(edit\) => !known\.has\(edit\.path\)\)/);
  assert.doesNotMatch(serviceSource, /deleteLibraryFiles|fs\.unlink/);
});

test("Core routes and Web client expose tag operations without host-file deletion", () => {
  assert.match(routesSource, /api\.post\("\/library\/tags\/read"/);
  assert.match(routesSource, /api\.post\("\/library\/tags\/write"/);
  assert.doesNotMatch(routesSource, /\/library\/files|deleteLibraryFiles/);
  assert.match(libraryClientSource, /request<IpcResponse<TrackTags>>\("\/library\/tags\/read"/);
  assert.match(
    libraryClientSource,
    /request<IpcResponse<TagWriteOutcome\[\]>>\("\/library\/tags\/write"/,
  );
  assert.doesNotMatch(libraryClientSource, /deleteTracks|\/library\/files/);
  assert.doesNotMatch(libraryTypesSource, /deleteTracks/);
});

test("Web tag editor edits Core files without a local filesystem picker", () => {
  assert.match(tagEditorSource, /newCoverUrl\.value = coverUrl/);
  assert.match(tagEditorSource, /libraryClient\.readTags\(props\.track\.path\)/);
  assert.doesNotMatch(tagEditorSource, /window\.api|hasHostCapability|pickCoverImage/);
});
