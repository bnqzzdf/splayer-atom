import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import test from "node:test";
import { listCoreDirectories, resolveCoreDirectory } from "./coreFilesystem";

const serviceSource = readFileSync(new URL("./coreFilesystem.ts", import.meta.url), "utf8");
const headlessRoutesSource = readFileSync(
  new URL("../atom/headless/routes.ts", import.meta.url),
  "utf8",
);
const compatRoutesSource = readFileSync(
  new URL("../atom/compat/routes.ts", import.meta.url),
  "utf8",
);
const libraryClientSource = readFileSync(
  new URL("../../src/core/libraryClient.ts", import.meta.url),
  "utf8",
);
const downloadClientSource = readFileSync(
  new URL("../../src/core/downloadClient.ts", import.meta.url),
  "utf8",
);
const pickerSource = readFileSync(
  new URL("../../src/web/CoreDirectoryPicker.vue", import.meta.url),
  "utf8",
);
const folderManagerSource = readFileSync(
  new URL("../../src/components/library/FolderManager.vue", import.meta.url),
  "utf8",
);
const downloadDirSource = readFileSync(
  new URL("../../src/components/settings/custom/DownloadDirConfig.vue", import.meta.url),
  "utf8",
);

test("Core filesystem browser resolves real directories and lists directories only", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "splayer-atom-core-fs-"));
  try {
    const child = path.join(root, "child");
    await mkdir(child);
    await writeFile(path.join(root, "track.flac"), "not-a-real-track");

    assert.equal(await resolveCoreDirectory(root), await resolveCoreDirectory(`${root}/.`));
    const listing = await listCoreDirectories(root);
    assert.equal(listing.path, await resolveCoreDirectory(root));
    assert.equal(listing.directories.length, 1);
    assert.equal(listing.directories[0].name, "child");
    assert.equal(listing.directories[0].path, child);
    assert.equal(listing.parent, path.dirname(root));
    await assert.rejects(
      resolveCoreDirectory(path.join(root, "track.flac")),
      /CORE_DIRECTORY_NOT_FOUND/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Core directory browser exposes only directory navigation", () => {
  assert.doesNotMatch(serviceSource, /from "electron"|ipcMain/);
  assert.match(serviceSource, /fs\.readdir\(current, \{ withFileTypes: true \}\)/);
  assert.match(headlessRoutesSource, /api\.get\("\/filesystem\/directories"/);
  assert.match(headlessRoutesSource, /listCoreDirectories\(c\.req\.query\("path"\)\)/);
});

test("Library scan roots are validated as Core directories instead of browser-local prompt strings", () => {
  assert.match(compatRoutesSource, /await resolveCoreDirectory\(requestedDir\)/);
  assert.match(libraryClientSource, /addScanDir: \(dir\) =>/);
  assert.match(libraryClientSource, /"\/library\/scan-dirs\/add"/);
  assert.match(folderManagerSource, /CoreDirectoryPicker/);
  assert.match(folderManagerSource, /libraryStore\.addScanDir\(dir\)/);
});

test("Download directory selection writes a validated Core path", () => {
  assert.match(headlessRoutesSource, /api\.post\("\/download\/dir"/);
  assert.match(headlessRoutesSource, /const dir = await resolveCoreDirectory\(body\.dir\)/);
  assert.match(downloadClientSource, /request<\{ dir: string \}>\("\/download\/dir"/);
  assert.match(downloadDirSource, /CoreDirectoryPicker/);
  assert.match(downloadDirSource, /downloadClient\.setDir\(selectedDir\)/);
});

test("Web Core directory picker supports navigation and explicit Core path entry", () => {
  assert.match(pickerSource, /\/filesystem\/directories/);
  assert.match(pickerSource, /v-model="pathInput"/);
  assert.match(pickerSource, /@keyup\.enter="load\(pathInput\)"/);
  assert.match(
    pickerSource,
    /if \(props\.initialPath && \(await load\(props\.initialPath\)\)\) return;/,
  );
  assert.match(pickerSource, /await load\(\);/);
  assert.match(pickerSource, /listing\?\.parent && load\(listing\.parent\)/);
  assert.match(pickerSource, /emit\("select", listing\.value\.path\)/);
  assert.match(serviceSource, /"\/media",\n\s+"\/mnt",\n\s+"\/home"/);
});
