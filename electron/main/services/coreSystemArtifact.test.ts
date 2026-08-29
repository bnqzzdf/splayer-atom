import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const viteSource = readFileSync(
  new URL("../../../scripts/atom/vite.core.config.ts", import.meta.url),
  "utf8",
);
const auditSource = readFileSync(
  new URL("../../../scripts/atom/check-core-build.mjs", import.meta.url),
  "utf8",
);
const stageSource = readFileSync(
  new URL("../../../scripts/atom/stage-core-system.ts", import.meta.url),
  "utf8",
);
const coreEntrySource = readFileSync(new URL("../core-node/index.ts", import.meta.url), "utf8");
const scannerSource = readFileSync(new URL("./scanner.ts", import.meta.url), "utf8");

test("Core production build targets Node 24 and keeps only better-sqlite3 external", () => {
  assert.match(viteSource, /publicDir: false/);
  assert.match(viteSource, /target: "node24"/);
  assert.match(viteSource, /external: \["better-sqlite3"\]/);
  assert.match(
    viteSource,
    /"electron-log": resolve\(root, "node_modules\/electron-log\/node\.js"\)/,
  );
});

test("Core build audit rejects Electron and unexpected package dependencies", () => {
  assert.match(auditSource, /allowedExternal = new Set\(\["better-sqlite3"\]\)/);
  assert.match(auditSource, /externalRefs\.has\("electron"\)/);
  assert.match(auditSource, /非预期 external dependency/);
});

test("system-runtime staging is reference-Node and release-native only", () => {
  assert.match(stageSource, /process\.versions\.node !== CORE_NODE_REFERENCE/);
  assert.match(stageSource, /process\.platform !== "linux" \|\| process\.arch !== "x64"/);
  assert.match(stageSource, /nativeBuild\.profile !== "release"/);
  assert.match(stageSource, /nativeBuild\.flavor !== "core-audio"/);
  assert.match(stageSource, /better-sqlite3\/package\.json/);
  assert.match(stageSource, /prebuilds", "linux-x64\.node"/);
  assert.match(stageSource, /audio-engine\.node/);
  assert.match(stageSource, /AGPL license/);
  assert.doesNotMatch(stageSource, /pnpm\s+(?:install|deploy)|npm\s+install|postinstall/);
});

test("Core artifact paths are bundle-relative and scanner stays Electron-free", () => {
  assert.match(coreEntrySource, /ATOM_RENDERER_DIR.*\.\.\/renderer/);
  assert.match(coreEntrySource, /ATOM_NATIVE_DIR.*\.\.\/native/);
  assert.match(scannerSource, /@main\/atom\/cacheUrl/);
  assert.doesNotMatch(scannerSource, /@main\/utils\/protocol/);
});
