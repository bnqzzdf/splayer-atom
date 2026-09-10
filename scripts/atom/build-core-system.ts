import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CORE_NODE_REFERENCE } from "../../core/atom/runtime/nodeRuntime";
import {
  coreArtifactFileName,
  readCoreReleaseMetadata,
  resolveCoreBuildDate,
} from "./core-artifact-name";

const root = fileURLToPath(new URL("../..", import.meta.url));
const args = new Set(process.argv.slice(2));
const requireDiretta = args.delete("--require-diretta");
const bundleNode = args.delete("--bundle-node");
if (args.size > 0) throw new Error(`[CoreBuild] 未知参数: ${[...args].join(" ")}`);
const release = readCoreReleaseMetadata();
const buildDate = resolveCoreBuildDate();
const buildEnv = { ...process.env, ATOM_BUILD_DATE: buildDate };

if (process.versions.node !== CORE_NODE_REFERENCE) {
  throw new Error(
    `[CoreBuild] system-runtime artifact 必须使用 reference Node ${CORE_NODE_REFERENCE}，当前为 ${process.versions.node}`,
  );
}
if (process.platform !== "linux" || process.arch !== "x64") {
  throw new Error(`[CoreBuild] 首个正式 Core artifact 仅支持 linux-x64`);
}

const bin = (name: string): string => path.join(root, "node_modules", ".bin", name);
const run = (label: string, command: string, commandArgs: string[]): void => {
  console.log(`[CoreBuild] ${label}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    env: buildEnv,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`[CoreBuild] ${label} 被信号终止: ${result.signal}`);
  if (result.status !== 0)
    throw new Error(`[CoreBuild] ${label} 失败: ${result.status ?? "unknown"}`);
};

run("构建 Core native release", bin("tsx"), [
  "scripts/atom/build-core-native.ts",
  ...(requireDiretta ? ["--require-diretta"] : []),
]);
run("构建 Core JS", bin("vite"), ["build", "-c", "scripts/atom/vite.core.config.ts"]);
run("验收 Core plugin-host IPC", process.execPath, ["scripts/atom/check-core-plugin-host.mjs"]);
run("构建 Web Control", bin("vite"), ["build", "-c", "vite.config.ts"]);
run("审计 Core build", process.execPath, ["scripts/atom/check-core-build.mjs"]);
run(bundleNode ? "生成 bundled-runtime tar.gz" : "生成 system-runtime tar.gz", bin("tsx"), [
  "scripts/atom/stage-core-system.ts",
  "--archive",
  ...(bundleNode ? ["--bundle-node"] : []),
]);
run("验收最终 tar artifact", bin("tsx"), [
  "scripts/atom/check-core-artifact.ts",
  ...(bundleNode ? ["--bundle-node"] : []),
]);

console.log(
  `[CoreBuild] PASS ${path.join(root, "out", coreArtifactFileName(bundleNode, release.version, buildDate))}`,
);
