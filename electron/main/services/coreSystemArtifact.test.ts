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
const buildSource = readFileSync(
  new URL("../../../scripts/atom/build-core-system.ts", import.meta.url),
  "utf8",
);
const webConfigSource = readFileSync(
  new URL("../../../scripts/atom/vite.web.config.ts", import.meta.url),
  "utf8",
);
const artifactCheckSource = readFileSync(
  new URL("../../../scripts/atom/check-core-artifact.ts", import.meta.url),
  "utf8",
);
const launcherSource = readFileSync(
  new URL("../../../scripts/atom/core-system/splayer-atom-core", import.meta.url),
  "utf8",
);
const serviceSource = readFileSync(
  new URL("../../../scripts/atom/core-system/splayer-atom-core.service", import.meta.url),
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

test("Core Web build reuses the Desktop renderer config without building Electron main/preload", () => {
  assert.match(webConfigSource, /ATOM_CORE_WEB_BUILD = "1"/);
  assert.match(webConfigSource, /electronConfig as \{ renderer: UserConfig \}/);
  assert.match(webConfigSource, /out", "renderer"/);
  assert.match(webConfigSource, /index: resolve\(root, "index\.html"\)/);
  assert.doesNotMatch(webConfigSource, /electron\/main|electron\/preload/);
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
  assert.match(stageSource, /splayer-atom-core-system-linux-x64\.tar\.gz/);
  assert.match(stageSource, /splayer-atom-core-bundled-linux-x64\.tar\.gz/);
  assert.match(stageSource, /const bundleNode = args\.delete\("--bundle-node"\)/);
  assert.match(stageSource, /cpSync\(process\.execPath, bundledNode\)/);
  assert.match(stageSource, /requireFile\(nodeLicense, "bundled Node license"\)/);
  assert.match(stageSource, /runtime", "LICENSE"/);
  assert.match(stageSource, /nodeBundled: bundleNode/);
  assert.match(stageSource, /productName: packageMetadata\.productName/);
  assert.match(stageSource, /atomVersion: packageMetadata\.version/);
  assert.match(stageSource, /atomCommit/);
  assert.match(stageSource, /sourceDirty/);
  assert.match(stageSource, /splayerBaseline: upstreamMetadata\.acceptedBaseline/);
  assert.match(stageSource, /--sort=name/);
  assert.match(stageSource, /--mtime=@0/);
  assert.doesNotMatch(stageSource, /pnpm\s+(?:install|deploy)|npm\s+install|postinstall/);
});

test("formal Core system build always rebuilds before staging and checks the final tar", () => {
  assert.match(buildSource, /const bundleNode = args\.delete\("--bundle-node"\)/);
  assert.match(buildSource, /\.\.\.\(bundleNode \? \["--bundle-node"\] : \[\]\)/);
  const nativeBuild = buildSource.indexOf("build-core-native.ts");
  const coreBuild = buildSource.indexOf("vite.core.config.ts");
  const webBuild = buildSource.indexOf("vite.web.config.ts");
  const audit = buildSource.indexOf("check-core-build.mjs");
  const stage = buildSource.indexOf("stage-core-system.ts");
  const artifact = buildSource.indexOf("check-core-artifact.ts");
  assert.ok(nativeBuild < coreBuild);
  assert.ok(coreBuild < webBuild);
  assert.ok(webBuild < audit);
  assert.ok(audit < stage);
  assert.ok(stage < artifact);
});

test("system-runtime launcher and systemd unit execute the same Core entry", () => {
  assert.match(launcherSource, /ATOM_NODE_BIN/);
  assert.match(launcherSource, /ATOM_RESOURCES_DIR="\$\{ATOM_RESOURCES_DIR:-\$ROOT_DIR\}"/);
  assert.match(launcherSource, /runtime\/bin\/node/);
  assert.match(launcherSource, /app\/index\.js/);
  assert.match(serviceSource, /WorkingDirectory=\/opt\/splayer-atom-core/);
  assert.match(serviceSource, /ExecStart=\/opt\/splayer-atom-core\/bin\/splayer-atom-core/);
  assert.match(serviceSource, /Diretta Host.*root/);
});

test("final tar artifact smoke starts the extracted Core on an isolated port", () => {
  assert.match(artifactCheckSource, /const bundleNode = args\.delete\("--bundle-node"\)/);
  assert.match(artifactCheckSource, /runtime\.nodeBundled !== bundleNode/);
  assert.match(artifactCheckSource, /bundleNode !== existsSync\(bundledNode\)/);
  assert.match(artifactCheckSource, /bundleNode !== existsSync\(bundledNodeLicense\)/);
  assert.match(artifactCheckSource, /bundled-runtime 缺少 Node LICENSE/);
  assert.match(artifactCheckSource, /ATOM_NODE_BIN: bundleNode \? "" : process\.execPath/);
  assert.match(artifactCheckSource, /realpathSync\(`\/proc\/\$\{child\.pid\}\/exe`\)/);
  assert.match(artifactCheckSource, /ATOM_SERVER_PORT: String\(port\)/);
  assert.match(artifactCheckSource, /cwd: tempDir/);
  assert.match(artifactCheckSource, /runtime\.productName !== "SPlayer Atom"/);
  assert.match(artifactCheckSource, /info\.version !== runtime\.atomVersion/);
  assert.match(artifactCheckSource, /info\.commit !== runtime\.atomCommit/);
  assert.match(artifactCheckSource, /info\.sourceDirty !== runtime\.sourceDirty/);
  assert.match(artifactCheckSource, /info\.splayerBaseline !== runtime\.splayerBaseline/);
  assert.match(artifactCheckSource, /info\.direttaSdkRelease !== runtime\.direttaSdkRelease/);
  assert.match(artifactCheckSource, /\/api\/info/);
  assert.match(artifactCheckSource, /\/api\/session/);
  assert.match(artifactCheckSource, /\/api\/library\/count/);
  assert.match(artifactCheckSource, /\/api\/cache\/stats/);
  assert.match(artifactCheckSource, /\/api\/cache\/dir/);
  assert.match(artifactCheckSource, /child\.kill\("SIGTERM"\)/);
});

test("system and bundled runtime remain deployment variants of the same staged Core", () => {
  assert.match(launcherSource, /elif \[ -x "\$ROOT_DIR\/runtime\/bin\/node" \]/);
  assert.match(launcherSource, /NODE_BIN=\$ROOT_DIR\/runtime\/bin\/node/);
  assert.match(stageSource, /splayer-atom-core-bundled-linux-x64\.tar\.gz/);
  assert.match(buildSource, /splayer-atom-core-bundled-linux-x64\.tar\.gz/);
  assert.match(artifactCheckSource, /splayer-atom-core-bundled-linux-x64\.tar\.gz/);
});

test("Core runtime metadata keeps database and config schema versions", () => {
  assert.match(
    stageSource,
    /dataSchema:\s*\{\s*database: DATABASE_SCHEMA_VERSION,\s*config: CONFIG_SCHEMA_VERSION,/s,
  );
  assert.match(artifactCheckSource, /runtime\.dataSchema\?\.database !== DATABASE_SCHEMA_VERSION/);
  assert.match(artifactCheckSource, /runtime\.dataSchema\.config !== CONFIG_SCHEMA_VERSION/);
  assert.match(artifactCheckSource, /runtime\.json data schema metadata 与当前构建不一致/);
});

test("Core runtime metadata records and validates the Diretta SDK release", () => {
  assert.match(stageSource, /direttaSdkRelease: nativeBuild\.direttaSdkRelease \?\? null/);
  assert.match(stageSource, /nativeBuild\.direttaSdkRelease !== DIRETTA_SDK_RELEASE/);
  assert.match(artifactCheckSource, /runtime\.direttaSdkRelease !== DIRETTA_SDK_RELEASE/);
  assert.match(artifactCheckSource, /no-Diretta artifact 不应携带 SDK release/);
});

test("Core artifact paths are bundle-relative and scanner stays Electron-free", () => {
  assert.match(coreEntrySource, /ATOM_RENDERER_DIR.*\.\.\/renderer/);
  assert.match(coreEntrySource, /ATOM_NATIVE_DIR.*\.\.\/native/);
  assert.match(scannerSource, /@main\/atom\/cacheUrl/);
  assert.doesNotMatch(scannerSource, /@main\/utils\/protocol/);
});
