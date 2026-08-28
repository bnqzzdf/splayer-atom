/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { execFileSync } from "node:child_process";

const upstreamRef = process.env.UPSTREAM_REF || "origin/dev";
// 31 个既有 Atom 集成触点，加 6 个经本地 Web/Headless 阶段验证后不可删除的必要 seam：
// Headless 主进程生命周期、Native DSD 扫描、Web 启动入口、main-session queue 投影、
// queue 权威态测试，以及移除 renderer 对播放索引/模式的重复持久化。
// NAPI/Vue 自动生成声明单独报告，不计入业务代码触点；后续新增触点仍必须单独论证。
const budget = Number(process.env.UPSTREAM_TOUCH_BUDGET || 37);
const metadataPaths = new Set(["AGENTS.md", "README.md", "README.zh-CN.md"]);
const generatedPaths = new Set(["native/audio-engine/index.d.ts", "components.d.ts"]);

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
  } else {
    upstreamCodeTouches.push(file);
  }
}

const printGroup = (title, files) => {
  console.log(`\n${title}: ${files.length}`);
  for (const file of files) console.log(`  ${file}`);
};

console.log(`Upstream ref: ${upstreamRef}`);
console.log(`Upstream code touch budget: ${budget}`);
printGroup("Upstream business-code touches", upstreamCodeTouches);
printGroup("Upstream generated touches", upstreamGeneratedTouches);
printGroup("Downstream metadata touches", downstreamMetadataTouches);
printGroup("Atom-owned additions", atomOwnedAdditions);

if (upstreamCodeTouches.length > budget) {
  console.error(
    `\nUpstream touch budget exceeded: ${upstreamCodeTouches.length} > ${budget}. Re-evaluate the integration seam.`,
  );
  process.exitCode = 1;
}
