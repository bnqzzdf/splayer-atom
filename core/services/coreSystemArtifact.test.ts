import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const viteSource = readFileSync(
  new URL("../../scripts/atom/vite.core.config.ts", import.meta.url),
  "utf8",
);
const auditSource = readFileSync(
  new URL("../../scripts/atom/check-core-build.mjs", import.meta.url),
  "utf8",
);
const stageSource = readFileSync(
  new URL("../../scripts/atom/stage-core-system.ts", import.meta.url),
  "utf8",
);
const buildSource = readFileSync(
  new URL("../../scripts/atom/build-core-system.ts", import.meta.url),
  "utf8",
);
const pluginSmokeSource = readFileSync(
  new URL("../../scripts/atom/check-core-plugin-host.mjs", import.meta.url),
  "utf8",
);
const webConfigSource = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
const artifactCheckSource = readFileSync(
  new URL("../../scripts/atom/check-core-artifact.ts", import.meta.url),
  "utf8",
);
const artifactNameSource = readFileSync(
  new URL("../../scripts/atom/core-artifact-name.ts", import.meta.url),
  "utf8",
);
const launcherSource = readFileSync(
  new URL("../../scripts/atom/core-system/splayer-atom-core", import.meta.url),
  "utf8",
);
const serviceSource = readFileSync(
  new URL("../../scripts/atom/core-system/splayer-atom-core.service", import.meta.url),
  "utf8",
);
const coreEntrySource = readFileSync(new URL("../core-node/index.ts", import.meta.url), "utf8");
const scannerSource = readFileSync(new URL("./scanner.ts", import.meta.url), "utf8");

test("Core production build targets Node 24 and keeps only better-sqlite3 external", () => {
  assert.match(viteSource, /publicDir: false/);
  assert.match(viteSource, /target: "node24"/);
  assert.match(viteSource, /external: \["better-sqlite3"\]/);
  assert.doesNotMatch(viteSource, /electron|electron-log/);
});

test("Web Control uses a standalone Vite build without Electron main or preload", () => {
  assert.match(webConfigSource, /SPlayer Atom 唯一 Web Control 构建配置/);
  assert.match(webConfigSource, /out", "renderer"/);
  assert.match(webConfigSource, /index: resolve\(root, "index\.html"\)/);
  assert.doesNotMatch(webConfigSource, /electron|preload|ATOM_CORE_WEB_BUILD/);
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
  assert.match(stageSource, /streaming-api\.node/);
  assert.match(stageSource, /callStreamingProvider/);
  assert.match(stageSource, /AGPL license/);
  assert.match(
    stageSource,
    /coreArtifactFileName\([\s\S]{0,120}?bundleNode,[\s\S]{0,40}?packageMetadata\.version,[\s\S]{0,60}?sourceIdentity\.commit,[\s\S]{0,60}?buildDate,[\s\S]{0,40}?buildTime,/,
  );
  assert.match(stageSource, /const bundleNode = args\.delete\("--bundle-node"\)/);
  assert.match(stageSource, /cpSync\(process\.execPath, bundledNode\)/);
  assert.match(stageSource, /requireFile\(nodeLicense, "bundled Node license"\)/);
  assert.match(stageSource, /runtime", "LICENSE"/);
  assert.match(stageSource, /nodeBundled: bundleNode/);
  assert.match(stageSource, /productName: packageMetadata\.productName/);
  assert.match(stageSource, /atomVersion: packageMetadata\.version/);
  assert.match(stageSource, /buildDate: formatCoreBuildDate\(buildDate\)/);
  assert.match(stageSource, /atomCommit/);
  assert.match(stageSource, /sourceDirty/);
  assert.doesNotMatch(stageSource, /splayerBaseline|acceptedBaseline|upstreamMetadata/);
  assert.match(stageSource, /--sort=name/);
  assert.match(stageSource, /--mtime=@\$\{archiveEpochSeconds\}/);
  assert.doesNotMatch(stageSource, /pnpm\s+(?:install|deploy)|npm\s+install|postinstall/);
});

test("formal Core system build always rebuilds before staging and checks the final tar", () => {
  assert.match(buildSource, /const bundleNode = args\.delete\("--bundle-node"\)/);
  assert.match(buildSource, /ATOM_BUILD_DATE: buildDate/);
  assert.match(buildSource, /\.\.\.\(bundleNode \? \["--bundle-node"\] : \[\]\)/);
  const nativeBuild = buildSource.indexOf("build-core-native.ts");
  const coreBuild = buildSource.indexOf("vite.core.config.ts");
  const webBuild = buildSource.indexOf('"vite.config.ts"');
  const audit = buildSource.indexOf("check-core-build.mjs");
  const pluginSmoke = buildSource.indexOf("check-core-plugin-host.mjs");
  const stage = buildSource.indexOf("stage-core-system.ts");
  const artifact = buildSource.indexOf("check-core-artifact.ts");
  assert.ok(nativeBuild < coreBuild);
  assert.ok(coreBuild < pluginSmoke);
  assert.ok(pluginSmoke < webBuild);
  assert.ok(webBuild < audit);
  assert.ok(audit < stage);
  assert.ok(stage < artifact);
  assert.match(pluginSmokeSource, /fork\(entry/);
  assert.match(pluginSmokeSource, /message\.kind === "hostReady"/);
  assert.match(pluginSmokeSource, /child\.send\(\{ kind: "ping" \}\)/);
  assert.match(pluginSmokeSource, /message\.kind === "pong"/);
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
  assert.match(artifactCheckSource, /runtime\.buildDate !== formatCoreBuildDate\(buildDate\)/);
  assert.match(artifactCheckSource, /info\.version !== runtime\.atomVersion/);
  assert.match(artifactCheckSource, /info\.commit !== runtime\.atomCommit/);
  assert.match(artifactCheckSource, /info\.sourceDirty !== runtime\.sourceDirty/);
  assert.doesNotMatch(artifactCheckSource, /splayerBaseline/);
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
  assert.match(
    stageSource,
    /coreArtifactFileName\([\s\S]{0,120}?bundleNode,[\s\S]{0,40}?packageMetadata\.version,[\s\S]{0,60}?sourceIdentity\.commit,[\s\S]{0,60}?buildDate,[\s\S]{0,40}?buildTime,/,
  );
  assert.match(
    buildSource,
    /coreArtifactFileName\([\s\S]{0,120}?bundleNode,[\s\S]{0,40}?release\.version,[\s\S]{0,80}?buildDate,[\s\S]{0,40}?buildTime,/,
  );
  assert.match(
    artifactCheckSource,
    /coreArtifactFileName\([\s\S]{0,120}?bundleNode,[\s\S]{0,40}?release\.version,[\s\S]{0,80}?buildDate,[\s\S]{0,40}?buildTime,/,
  );
  assert.match(
    artifactNameSource,
    /splayer-atom-core-\$\{version\}-\$\{shortCoreCommit\(commit\)\}-\$\{buildDate\}-\$\{buildTime\}\$\{coreArtifactSuffix\(bundleNode, direttaVariant\)\}/,
  );

  // 打包时刻进入文件名：同一天多次构建不会互相覆盖
  assert.match(artifactNameSource, /resolveCoreBuildTime/);
  assert.match(artifactNameSource, /ATOM_BUILD_TIME 必须使用 HHMMSS 格式/);
  // 内容可复现性保持不变：runtime.json 仍然只记日期，不记时刻
  assert.match(stageSource, /buildDate: formatCoreBuildDate\(buildDate\)/);
  assert.doesNotMatch(stageSource, /buildTime: buildTime/);
  // build-core-system 把时刻一次性下发，保证 stage 与 check 算出同一个文件名
  assert.match(buildSource, /ATOM_BUILD_TIME: buildTime/);
  // 单独运行/跨天复核时退回「取最新产物」，不再依赖秒级重建
  assert.match(artifactCheckSource, /findLatestCoreArtifact\(root, bundleNode, direttaVariant\)/);
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

test("产物解包后直接是安装根，不再套 core-system/ 这一层", () => {
  // 归档从暂存目录内部创建（cwd = out/core-system，成员是 "."），
  // 于是解包到目标路径即得到 app/ renderer/ bin/ runtime.json …。
  // 一旦有人改回 `cwd: out` + 成员 "core-system"，部署脚本又会多出一层目录。
  const tarStart = stageSource.indexOf("const tar = spawnSync(");
  const tarEnd = stageSource.indexOf("if (tar.error)", tarStart);
  assert.ok(tarStart > 0 && tarEnd > tarStart, "未找到 tar 调用");
  const tarCall = stageSource.slice(tarStart, tarEnd);
  assert.match(tarCall, /"tar",/);
  assert.match(tarCall, /"-czf",\s*archiveFile,\s*"\.",/);
  assert.doesNotMatch(tarCall, /"core-system"/);
  assert.match(tarCall, /cwd: outputDir/);

  // 校验脚本按同一个约定解包：安装根就是解包目录本身
  assert.match(artifactCheckSource, /const installRoot = tempDir;/);
  assert.doesNotMatch(artifactCheckSource, /path\.join\(tempDir, "core-system"\)/);
});
