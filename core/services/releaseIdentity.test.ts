import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative: string): string =>
  readFileSync(new URL(`../../${relative}`, import.meta.url), "utf8");

const packageJson = JSON.parse(read("package.json")) as {
  name?: string;
  productName?: string;
  version?: string;
  description?: string;
  repository?: { url?: string };
  bugs?: { url?: string };
};
const direttaSdkSource = read("scripts/atom/diretta-sdk.ts");
const artifactNameSource = read("scripts/atom/core-artifact-name.ts");
const stageSource = read("scripts/atom/stage-core-system.ts");
const artifactSource = read("scripts/atom/check-core-artifact.ts");
const coreInfoSource = read("core/atom/runtime/coreInfo.ts");
const musicBrainzSource = read("core/apis/musicbrainz.ts");
const jellyfinSource = read("core/services/streaming/adapters/jellyfin.ts");
const subsonicSource = read("core/services/streaming/adapters/subsonic.ts");
const githubApiSource = read("src/apis/github.ts");
const webEntrySource = read("index.html");
const webBootstrapSource = read("src/main.ts");
const productBrandSource = read("src/components/brand/ProductBrand.vue");
const aboutSettingsSource = read("src/components/settings/custom/AboutSettings.vue");
const serverSource = read("core/server/index.ts");

test("SPlayer Atom owns a Node Core and Web Control product identity", () => {
  assert.equal(packageJson.name, "splayer-atom");
  assert.equal(packageJson.productName, "SPlayer Atom");
  assert.equal(packageJson.version, "1.1.1");
  assert.match(packageJson.description ?? "", /Web \+ Core music player adapted from SPlayer-Next/);
  assert.equal(packageJson.repository?.url, "https://github.com/bnqzzdf/splayer-atom");
  assert.equal(packageJson.bugs?.url, "https://github.com/bnqzzdf/splayer-atom/issues");
});

test("Core artifact carries Atom version commit and dirty state", () => {
  assert.match(stageSource, /productName: packageMetadata\.productName/);
  assert.match(stageSource, /atomVersion: packageMetadata\.version/);
  assert.match(stageSource, /buildDate: formatCoreBuildDate\(buildDate\)/);
  assert.match(stageSource, /atomCommit/);
  assert.match(stageSource, /sourceDirty/);
  assert.match(artifactSource, /runtime\.productName !== "SPlayer Atom"/);
  assert.match(artifactSource, /info\.version !== runtime\.atomVersion/);
  assert.match(artifactSource, /info\.commit !== runtime\.atomCommit/);
  assert.match(artifactSource, /info\.sourceDirty !== runtime\.sourceDirty/);
  assert.match(coreInfoSource, /release\.atomVersion/);
  assert.match(coreInfoSource, /release\.atomCommit/);
  assert.doesNotMatch(stageSource, /splayerBaseline|acceptedBaseline|upstreamMetadata/);
  assert.doesNotMatch(artifactSource, /splayerBaseline/);
  assert.doesNotMatch(coreInfoSource, /splayerBaseline|ATOM_SPLAYER_BASELINE/);
});

test("Core package filenames contain product version, build date and build time", () => {
  assert.match(artifactNameSource, /ATOM_BUILD_DATE/);
  assert.match(artifactNameSource, /\^\\d\{8\}\$/);
  // 打包时刻进入文件名：同一天多次构建不会互相覆盖
  assert.match(artifactNameSource, /ATOM_BUILD_TIME/);
  assert.match(artifactNameSource, /\^\\d\{6\}\$/);
  assert.match(
    artifactNameSource,
    /splayer-atom-core-\$\{version\}-\$\{shortCoreCommit\(commit\)\}-\$\{buildDate\}-\$\{buildTime\}\$\{coreArtifactSuffix\(bundleNode, direttaVariant\)\}/,
  );
  // Diretta 变体进入文件名：同一版本会为不同 CPU 代次各出一个 tar，
  // 名字里不带变体就分不清能不能在手上这台机器跑。
  assert.match(artifactNameSource, /-diretta-\$\{direttaVariant\}/);
  assert.match(artifactNameSource, /coreArtifactSuffix\(bundleNode, direttaVariant\)/);
  assert.match(artifactNameSource, /export const readDirettaCpuVariantFromNativeBuild = /);
  // 变体清单必须覆盖 SDK 实际发布的 x86-64 型号
  assert.match(direttaSdkSource, /DIRETTA_CPU_VARIANTS = \["v2", "v3", "v4", "zen4"\] as const/);
  // 提交号进入文件名：拿到一个 tar 就能知道它出自哪次提交，无需解包读 runtime.json
  assert.match(artifactNameSource, /export const shortCoreCommit = \(commit: string\): string =>/);
  assert.match(artifactNameSource, /\^\[0-9a-f\]\{8,40\}\$/);
  assert.match(artifactNameSource, /value\.slice\(0, 8\)/);
  // 解析失败要抛错，避免把垃圾写进文件名
  assert.match(artifactNameSource, /产物名需要合法的 commit/);
});

test("runtime integrations identify the current product as SPlayer Atom", () => {
  assert.match(musicBrainzSource, /SPlayer-Atom\/\$\{runtimeEnvironment\.appVersion\}/);
  assert.match(musicBrainzSource, /github\.com\/bnqzzdf\/splayer-atom/);
  assert.match(jellyfinSource, /const CLIENT_NAME = "SPlayer Atom"/);
  assert.match(jellyfinSource, /const CLIENT_VERSION = runtimeEnvironment\.appVersion/);
  assert.match(jellyfinSource, /`splayer-atom-\$\{config\.id\}`/);
  assert.match(subsonicSource, /const CLIENT_NAME = "SPlayer Atom"/);
  assert.match(githubApiSource, /const repoSlug = "bnqzzdf\/splayer-atom"/);
  assert.match(serverSource, /SPlayer Atom Core API; Web Control is served by Vite/);
});

test("Web branding exposes Atom and contains no Electron bootstrap", () => {
  assert.match(webEntrySource, /<title>SPlayer Atom<\/title>/);
  assert.doesNotMatch(webEntrySource, /SPlayer Next/);
  assert.doesNotMatch(webBootstrapSource, /electron|ipcRenderer|preload/);
  assert.match(aboutSettingsSource, /<ProductBrand size="about" \/>/);
  assert.match(productBrandSource, />SPlayer<\/span>/);
  assert.match(productBrandSource, /ATOM/);
});
