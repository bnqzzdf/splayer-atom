import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serviceSource = readFileSync(new URL("./libraryFiles.ts", import.meta.url), "utf8");
const ipcSource = readFileSync(new URL("../ipc/library.ts", import.meta.url), "utf8");
const routesSource = readFileSync(new URL("../atom/compat/routes.ts", import.meta.url), "utf8");
const webApiSource = readFileSync(new URL("../../../src/web/api.ts", import.meta.url), "utf8");
const tagEditorSource = readFileSync(
  new URL("../../../src/components/modals/TagEditorDialog.vue", import.meta.url),
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

test("Desktop Library IPC delegates tag and delete business to the shared Core service", () => {
  const sharedSection = between(
    ipcSource,
    "// 读取本地文件的可编辑标签",
    "// 弹出文件选择器，选择封面图片",
  );
  assert.match(sharedSection, /await readLibraryTags\(path\)/);
  assert.match(sharedSection, /await writeLibraryTags\(edits\)/);
  assert.doesNotMatch(sharedSection, /writeTrackTags|fetchBytes|scannedToUpsert/);
  assert.match(ipcSource, /await deleteLibraryFiles\(paths\)/);
});

test("Headless and Web expose real Core library delete and tag operations", () => {
  assert.match(routesSource, /api\.post\("\/library\/tags\/read"/);
  assert.match(routesSource, /api\.post\("\/library\/tags\/write"/);
  assert.match(routesSource, /api\.delete\("\/library\/files"/);
  assert.match(webApiSource, /request<IpcResponse<TrackTags>>\("\/library\/tags\/read"/);
  assert.match(webApiSource, /request<IpcResponse<TagWriteOutcome\[\]>>\("\/library\/tags\/write"/);
  assert.match(
    webApiSource,
    /request<IpcResponse<\{ deleted: number; failed: number \}>>\("\/library\/files"/,
  );
  assert.doesNotMatch(webApiSource, /WEB_TAG_EDIT_UNSUPPORTED|Web 文件删除尚未开放/);
});

test("Web tag editor hides only the Control-local cover file picker", () => {
  assert.match(tagEditorSource, /hasHostCapability\("nativeFileDialogs"\)/);
  assert.match(tagEditorSource, /v-if="localCoverPickerAvailable"/);
  assert.match(tagEditorSource, /newCoverUrl\.value = coverUrl/);
  assert.match(tagEditorSource, /window\.api\.library\.readTags\(props\.track\.path\)/);
});
