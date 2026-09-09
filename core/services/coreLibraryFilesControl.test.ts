import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serviceSource = readFileSync(new URL("./libraryFiles.ts", import.meta.url), "utf8");
const routesSource = readFileSync(new URL("../atom/compat/routes.ts", import.meta.url), "utf8");
const libraryClientSource = readFileSync(
  new URL("../../src/core/libraryClient.ts", import.meta.url),
  "utf8",
);
const tagEditorSource = readFileSync(
  new URL("../../src/components/modals/TagEditorDialog.vue", import.meta.url),
  "utf8",
);

const between = (source: string, start: string, end: string): string => {
  const tail = source.split(start)[1];
  assert.ok(tail, `missing start marker: ${start}`);
  const section = tail.split(end)[0];
  assert.ok(section, `missing end marker: ${end}`);
  return section;
};

test("Core library file service stays Electron-free and scopes mutation to known library paths", () => {
  assert.doesNotMatch(serviceSource, /from "electron"/);
  assert.match(serviceSource, /getAllTracks\(\)/);
  assert.match(serviceSource, /assertKnownLibraryPath\(filePath\)/);
  assert.match(serviceSource, /edits\.some\(\(edit\) => !known\.has\(edit\.path\)\)/);
  const deleteFlow = between(
    serviceSource,
    "export const deleteLibraryFiles = async",
    "return { deleted: deleted.length, failed: failed.length };",
  );
  const guardIndex = deleteFlow.indexOf("if (!known.has(filePath))");
  const unlinkIndex = deleteFlow.indexOf("await fs.unlink(filePath)");
  assert.ok(guardIndex >= 0);
  assert.ok(unlinkIndex > guardIndex);
});

test("Core routes and Web client expose real library delete and tag operations", () => {
  assert.match(routesSource, /api\.post\("\/library\/tags\/read"/);
  assert.match(routesSource, /api\.post\("\/library\/tags\/write"/);
  assert.match(routesSource, /api\.delete\("\/library\/files"/);
  assert.match(libraryClientSource, /request<IpcResponse<TrackTags>>\("\/library\/tags\/read"/);
  assert.match(
    libraryClientSource,
    /request<IpcResponse<TagWriteOutcome\[\]>>\("\/library\/tags\/write"/,
  );
  assert.match(
    libraryClientSource,
    /request<IpcResponse<\{ deleted: number; failed: number \}>>\("\/library\/files"/,
  );
});

test("Web tag editor edits Core files without a local filesystem picker", () => {
  assert.match(tagEditorSource, /newCoverUrl\.value = coverUrl/);
  assert.match(tagEditorSource, /libraryClient\.readTags\(props\.track\.path\)/);
  assert.doesNotMatch(tagEditorSource, /window\.api|hasHostCapability|pickCoverImage/);
});
