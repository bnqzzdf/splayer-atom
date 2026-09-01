/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const upstreamConfig = JSON.parse(
  readFileSync(new URL("./upstream.json", import.meta.url), "utf8"),
);
const upstreamRef = process.env.UPSTREAM_REF || upstreamConfig.acceptedBaseline;
// 预算是相对 accepted baseline 审计过的现有上限，不是扩张目标。atom-base 重放使旧的
// 113 文件快照失效；接受当前官方基线后逐项复核为 130。新增触点仍必须先收口设计，
// 不得靠路径重分类或自动抬高预算隐藏增长。
const budget = Number(process.env.UPSTREAM_TOUCH_BUDGET || 130);
const runtimeSeamBudget = Number(process.env.UPSTREAM_RUNTIME_SEAM_BUDGET || 22);
const coreAuthoritySeamBudget = Number(process.env.UPSTREAM_CORE_AUTHORITY_SEAM_BUDGET || 13);
// 正式产品身份必须修改少量上游 packaging/updater/对外 product-identification 表面；单独计数，避免伪装成业务逻辑扩张。
const releaseIdentitySeamBudget = Number(process.env.UPSTREAM_RELEASE_IDENTITY_SEAM_BUDGET || 20);
const metadataPaths = new Set([
  ".gitignore",
  ".github/copilot-instructions.md",
  ".github/instructions/review.instructions.md",
  "AGENTS.md",
  "CLAUDE.md",
  "eslint.config.mjs",
  "README.md",
  "README.zh-CN.md",
  "demo/audio-architecture.md",
  "demo/desktop-lyric-drag.md",
]);
const releaseIdentitySeamPaths = new Set([
  ".github/scripts/prepare-release-assets.cjs",
  ".github/scripts/prepare-release-assets.test.cjs",
  ".github/workflows/dev.yml",
  ".github/workflows/release.yml",
  "docs/contributing.md",
  "docs/download.md",
  "docs/en/contributing.md",
  "docs/en/download.md",
  "dev-app-update.yml",
  "electron-builder.config.ts",
  "index.html",
  "electron/main/ipc/config.ts",
  "electron/main/services/updater.ts",
  "electron/main/services/streaming/adapters/jellyfin.ts",
  "electron/main/services/streaming/adapters/subsonic.ts",
  "electron/main/window/desktopLyric.ts",
  "package.json",
  "src/apis/github.ts",
  "src/components/layout/SideBarLogo.vue",
  "src/settings/categories/general.ts",
]);
const generatedPaths = new Set([
  "native/audio-engine/index.d.ts",
  "components.d.ts",
  "src/env.d.ts",
]);
const runtimeNeutralSeamPaths = new Set([
  "electron.vite.config.ts",
  "electron/main/apis/musicbrainz.ts",
  "electron/main/database/migration.ts",
  "electron/main/index.ts",
  "electron/main/ipc/cache.ts",
  "electron/main/plugins/host-process.ts",
  "electron/main/plugins/net.ts",
  "electron/main/plugins/registry.ts",
  "electron/main/server/routes.ts",
  "electron/main/services/device.ts",
  "electron/main/services/engine.ts",
  "electron/main/services/playerControl.ts",
  "electron/main/services/scanner.ts",
  "electron/main/services/songCache.ts",
  "electron/main/store/index.ts",
  "electron/main/utils/config.ts",
  "electron/main/utils/fetchBytes.ts",
  "electron/main/utils/logger.ts",
  "electron/main/utils/nativeLoader.ts",
  "electron/main/utils/paths.ts",
  "electron/main/utils/protocol.ts",
  "native/audio-engine/src/device_watcher/mod.rs",
]);
const coreAuthoritySeamPaths = new Set([
  "shared/defaults/settings.ts",
  "shared/types/settings.ts",
  "src/components/modals/FmModeDialog.vue",
  "src/components/player/QualityControl.vue",
  "src/settings/categories/other.ts",
  "src/settings/categories/player.ts",
  "src/services/autoClose.ts",
  "src/stores/settings.ts",
  "src/stores/user.ts",
  "src/types/netease.ts",
  "src/types/settings.ts",
  "src/utils/format/netease.ts",
  "src/utils/preset/djMode.ts",
]);

const git = (args, options = {}) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", options.quiet ? "ignore" : "pipe"],
  }).trim();

const lines = (text) => (text ? text.split("\n").filter(Boolean) : []);
const changed = new Set([
  ...lines(git(["diff", "--name-only", upstreamRef])),
  ...lines(git(["ls-files", "--others", "--exclude-standard"])),
]);

const existsInUpstream = (file) => {
  try {
    git(["cat-file", "-e", `${upstreamRef}:${file}`], { quiet: true });
    return true;
  } catch {
    return false;
  }
};

const upstreamCodeTouches = [];
const upstreamRuntimeSeamTouches = [];
const upstreamCoreAuthoritySeamTouches = [];
const upstreamReleaseIdentitySeamTouches = [];
const upstreamGeneratedTouches = [];
const downstreamMetadataTouches = [];
const atomOwnedAdditions = [];

for (const file of [...changed].sort()) {
  if (!existsInUpstream(file)) {
    atomOwnedAdditions.push(file);
  } else if (metadataPaths.has(file)) {
    downstreamMetadataTouches.push(file);
  } else if (generatedPaths.has(file)) {
    upstreamGeneratedTouches.push(file);
  } else if (releaseIdentitySeamPaths.has(file)) {
    upstreamReleaseIdentitySeamTouches.push(file);
  } else if (runtimeNeutralSeamPaths.has(file)) {
    upstreamRuntimeSeamTouches.push(file);
  } else if (coreAuthoritySeamPaths.has(file)) {
    upstreamCoreAuthoritySeamTouches.push(file);
  } else {
    upstreamCodeTouches.push(file);
  }
}

const printGroup = (title, files) => {
  console.log(`\n${title}: ${files.length}`);
  for (const file of files) console.log(`  ${file}`);
};

console.log(`Upstream ref: ${upstreamRef}`);
console.log(`Upstream business-code touch budget: ${budget}`);
console.log(`Upstream runtime-neutral seam budget: ${runtimeSeamBudget}`);
console.log(`Upstream Core-authority seam budget: ${coreAuthoritySeamBudget}`);
console.log(`Upstream release-identity seam budget: ${releaseIdentitySeamBudget}`);
printGroup("Upstream business-code touches", upstreamCodeTouches);
printGroup("Upstream runtime-neutral seam touches", upstreamRuntimeSeamTouches);
printGroup("Upstream Core-authority seam touches", upstreamCoreAuthoritySeamTouches);
printGroup("Upstream release-identity seam touches", upstreamReleaseIdentitySeamTouches);
printGroup("Upstream generated touches", upstreamGeneratedTouches);
printGroup("Downstream metadata touches", downstreamMetadataTouches);
printGroup("Atom-owned additions", atomOwnedAdditions);

if (upstreamCodeTouches.length > budget) {
  console.error(
    `\nUpstream business-code touch budget exceeded: ${upstreamCodeTouches.length} > ${budget}. Re-evaluate the integration seam.`,
  );
  process.exitCode = 1;
}

if (upstreamRuntimeSeamTouches.length > runtimeSeamBudget) {
  console.error(
    `\nUpstream runtime-neutral seam budget exceeded: ${upstreamRuntimeSeamTouches.length} > ${runtimeSeamBudget}. Re-evaluate the Core/Desktop boundary.`,
  );
  process.exitCode = 1;
}

if (upstreamCoreAuthoritySeamTouches.length > coreAuthoritySeamBudget) {
  console.error(
    `\nUpstream Core-authority seam budget exceeded: ${upstreamCoreAuthoritySeamTouches.length} > ${coreAuthoritySeamBudget}. Re-evaluate whether Control still owns playback policy.`,
  );
  process.exitCode = 1;
}

if (upstreamReleaseIdentitySeamTouches.length > releaseIdentitySeamBudget) {
  console.error(
    `\nUpstream release-identity seam budget exceeded: ${upstreamReleaseIdentitySeamTouches.length} > ${releaseIdentitySeamBudget}. Re-evaluate whether the product identity change is touching runtime business code unnecessarily.`,
  );
  process.exitCode = 1;
}
