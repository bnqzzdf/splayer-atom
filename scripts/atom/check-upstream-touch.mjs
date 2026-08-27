/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { execFileSync } from "node:child_process";

const upstreamRef = process.env.UPSTREAM_REF || "origin/dev";
// 8 provider integration touches + one stable external-server mount + four native
// Source Direct build/module seams + twelve Direct Lifecycle/renderer integration seams
// + six Direct UI transparency touches (Toolbar, EQ/speed dialogs, player settings, zh/en i18n).
// Generated NAPI/Vue auto-import declarations are reported separately and do not count as business code.
// Any further upstream business-code touch must be justified separately.
const budget = Number(process.env.UPSTREAM_TOUCH_BUDGET || 31);
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
