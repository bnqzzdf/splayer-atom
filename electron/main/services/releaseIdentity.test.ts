import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative: string): string =>
  readFileSync(new URL(`../../../${relative}`, import.meta.url), "utf8");

const packageJson = JSON.parse(read("package.json")) as {
  name?: string;
  productName?: string;
  version?: string;
  desktopName?: string;
  repository?: { url?: string };
  bugs?: { url?: string };
};
const builderSource = read("electron-builder.config.ts");
const updaterSource = read("electron/main/services/updater.ts");
const coreSource = read("electron/main/core/index.ts");
const electronEntrySource = read("electron/main/index.ts");
const devUpdateSource = read("dev-app-update.yml");
const releaseWorkflowSource = read(".github/workflows/release.yml");
const devWorkflowSource = read(".github/workflows/dev.yml");
const releaseAssetsSource = read(".github/scripts/prepare-release-assets.cjs");
const defaultsSource = read("shared/defaults/settings.ts");
const orpheusSource = read("electron/main/services/orpheus.ts");
const musicBrainzSource = read("electron/main/apis/musicbrainz.ts");
const jellyfinSource = read("electron/main/services/streaming/adapters/jellyfin.ts");
const subsonicSource = read("electron/main/services/streaming/adapters/subsonic.ts");
const desktopLyricSource = read("electron/main/window/desktopLyric.ts");
const githubApiSource = read("src/apis/github.ts");
const webEntrySource = read("index.html");
const webBootstrapSource = read("src/main.ts");
const sidebarLogoSource = read("src/components/layout/SideBarLogo.vue");
const serverSource = read("electron/main/server/index.ts");

test("SPlayer Atom owns an installation and repository identity distinct from upstream", () => {
  assert.equal(packageJson.name, "splayer-atom");
  assert.equal(packageJson.productName, "SPlayer Atom");
  assert.equal(packageJson.version, "0.1.0");
  assert.equal(packageJson.desktopName, "io.github.bnqzzdf.splayer_atom");
  assert.equal(packageJson.repository?.url, "https://github.com/bnqzzdf/splayer-atom");
  assert.equal(packageJson.bugs?.url, "https://github.com/bnqzzdf/splayer-atom/issues");

  assert.match(builderSource, /appId: "io\.github\.bnqzzdf\.splayer-atom"/);
  assert.match(builderSource, /productName: "SPlayer Atom"/);
  assert.match(builderSource, /guid: "io\.github\.bnqzzdf\.splayer-atom"/);
  assert.match(coreSource, /setAppUserModelId\("io\.github\.bnqzzdf\.splayer-atom"\)/);
  assert.match(builderSource, /extraMetadata: \{ atomCommit, atomSourceDirty, splayerBaseline \}/);
  assert.match(electronEntrySource, /process\.env\.ATOM_COMMIT = releaseIdentity\.atomCommit/);
  assert.match(electronEntrySource, /process\.env\.ATOM_SOURCE_DIRTY/);
  assert.match(
    electronEntrySource,
    /process\.env\.ATOM_SPLAYER_BASELINE = releaseIdentity\.splayerBaseline/,
  );
});

test("Atom installer does not silently steal the upstream Orpheus protocol", () => {
  assert.doesNotMatch(builderSource, /protocols:|CFBundleURLTypes|x-scheme-handler\/orpheus/);
  assert.match(defaultsSource, /registerOrpheusProtocol: false/);
  assert.match(orpheusSource, /setAsDefaultProtocolClient\(ORPHEUS_SCHEME\)/);
  assert.match(orpheusSource, /if \(store\.get\("system\.registerOrpheusProtocol"\)\)/);
});

test("Atom updater and publish targets can never silently fall back to SPlayer-Next", () => {
  for (const source of [builderSource, updaterSource, devUpdateSource, releaseWorkflowSource]) {
    assert.doesNotMatch(
      source,
      /SPlayer-Dev\/SPlayer-Next|owner:\s*"?SPlayer-Dev|repo:\s*"?SPlayer-Next/,
    );
  }
  assert.match(builderSource, /owner: "bnqzzdf"/);
  assert.match(builderSource, /repo: "splayer-atom"/);
  assert.match(updaterSource, /github\.com\/bnqzzdf\/splayer-atom\/releases/);
  assert.match(devUpdateSource, /owner: bnqzzdf/);
  assert.match(devUpdateSource, /repo: splayer-atom/);
  assert.match(devUpdateSource, /updaterCacheDirName: splayer-atom-updater/);
});

test("formal release workflow is pinned to the Atom repository and a clean source tree", () => {
  assert.match(releaseWorkflowSource, /GITHUB_REPOSITORY.*bnqzzdf\/splayer-atom/);
  assert.match(releaseWorkflowSource, /git status --porcelain --untracked-files=normal/);
  assert.match(releaseWorkflowSource, /正式 release 必须来自 clean source tree/);
});

test("formal Atom release channels are stable and beta only", () => {
  assert.match(builderSource, /releaseChannel !== "stable" && releaseChannel !== "beta"/);
  assert.match(builderSource, /releaseChannel === "stable" \? "latest" : "beta"/);
  assert.match(releaseWorkflowSource, /UPDATE_CHANNEL=stable/);
  assert.match(releaseWorkflowSource, /UPDATE_CHANNEL=beta/);
  assert.doesNotMatch(releaseWorkflowSource, /UPDATE_CHANNEL=alpha|\*-alpha/);
  assert.doesNotMatch(releaseAssetsSource, /\balpha\b/);
});

test("runtime integrations identify the current product as SPlayer Atom", () => {
  assert.match(musicBrainzSource, /SPlayer-Atom\/\$\{runtimeEnvironment\.appVersion\}/);
  assert.match(musicBrainzSource, /github\.com\/bnqzzdf\/splayer-atom/);
  assert.match(jellyfinSource, /const CLIENT_NAME = "SPlayer Atom"/);
  assert.match(jellyfinSource, /const CLIENT_VERSION = runtimeEnvironment\.appVersion/);
  assert.match(jellyfinSource, /`splayer-atom-\$\{config\.id\}`/);
  assert.match(subsonicSource, /const CLIENT_NAME = "SPlayer Atom"/);
  assert.match(desktopLyricSource, /title: "SPlayer Atom - Desktop Lyric"/);
  assert.match(githubApiSource, /const repoSlug = "bnqzzdf\/splayer-atom"/);
  assert.match(webEntrySource, /<title>SPlayer Atom<\/title>/);
  assert.doesNotMatch(webEntrySource, /app-loading|splash/i);
  assert.doesNotMatch(webBootstrapSource, /app-loading|splash/i);
  assert.doesNotMatch(webEntrySource, /SPlayer Next/);
  assert.match(sidebarLogoSource, />SPlayer<\/span>/);
  assert.match(sidebarLogoSource, /ATOM/);
  assert.match(serverSource, /SPlayer Atom external API/);
  assert.match(serverSource, /c\.header\("Cache-Control", "no-store"\)/);
});

test("CI artifact labels expose Atom rather than upstream product identity", () => {
  assert.doesNotMatch(releaseWorkflowSource, /SPlayer-Next-/);
  assert.doesNotMatch(devWorkflowSource, /SPlayer-Next-/);
  assert.match(releaseWorkflowSource, /SPlayer-Atom-\$\{\{ matrix\.name \}\}/);
  assert.match(devWorkflowSource, /SPlayer-Atom-Windows-setup/);
});
