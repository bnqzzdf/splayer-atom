/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const upstreamConfig = JSON.parse(
  readFileSync(new URL("./upstream.json", import.meta.url), "utf8"),
);
const upstreamRef = process.env.UPSTREAM_REF || upstreamConfig.acceptedBaseline;
// 31 个既有 Atom 集成触点，加 6 个经本地 Web/Headless 阶段验证后不可删除的必要 seam：
// Headless 主进程生命周期、Native DSD 扫描、Web 启动入口、main-session queue 投影、
// queue 权威态测试，以及移除 renderer 对播放索引/模式的重复持久化。
// NAPI/Vue 自动生成声明、Node Core runtime-neutral seam 与 Core-authority seam 单独报告，
// 不计入业务代码触点；两类架构 seam 仍各自有独立预算，避免借迁移无限扩大上游改动面。
const budget = Number(process.env.UPSTREAM_TOUCH_BUDGET || 37);
const runtimeSeamBudget = Number(process.env.UPSTREAM_RUNTIME_SEAM_BUDGET || 16);
const coreAuthoritySeamBudget = Number(process.env.UPSTREAM_CORE_AUTHORITY_SEAM_BUDGET || 12);
const metadataPaths = new Set(["AGENTS.md", "README.md", "README.zh-CN.md"]);
const generatedPaths = new Set(["native/audio-engine/index.d.ts", "components.d.ts"]);
const runtimeNeutralSeamPaths = new Set([
  "electron/main/apis/musicbrainz.ts",
  "electron/main/index.ts",
  "electron/main/plugins/host-process.ts",
  "electron/main/plugins/net.ts",
  "electron/main/plugins/registry.ts",
  "electron/main/server/routes.ts",
  "electron/main/services/device.ts",
  "electron/main/services/playerControl.ts",
  "electron/main/services/scanner.ts",
  "electron/main/services/songCache.ts",
  "electron/main/store/index.ts",
  "electron/main/utils/config.ts",
  "electron/main/utils/fetchBytes.ts",
  "electron/main/utils/nativeLoader.ts",
  "electron/main/utils/paths.ts",
  "electron/main/utils/protocol.ts",
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
printGroup("Upstream business-code touches", upstreamCodeTouches);
printGroup("Upstream runtime-neutral seam touches", upstreamRuntimeSeamTouches);
printGroup("Upstream Core-authority seam touches", upstreamCoreAuthoritySeamTouches);
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
