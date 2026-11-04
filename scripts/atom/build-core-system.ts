import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CORE_NODE_REFERENCE } from "../../core/atom/runtime/nodeRuntime";
import {
  coreArtifactFileName,
  readCoreReleaseMetadata,
  readDirettaCpuVariantFromNativeBuild,
  resolveCoreBuildDate,
  resolveCoreBuildTime,
  type CoreRuntimeFlavor,
} from "./core-artifact-name";
import { resolveSourceIdentity, unpublishedIdentityMessage } from "./sourceIdentity";

const root = fileURLToPath(new URL("../..", import.meta.url));
const args = new Set(process.argv.slice(2));
const requireDiretta = args.delete("--require-diretta");
const legacyBundleNode = args.delete("--bundle-node");
const bundleRuntime = args.delete("--bundle-runtime") || legacyBundleNode;
const allowUnpublished = args.delete("--allow-unpublished");
const runtimeArg = [...args].find((arg) => arg.startsWith("--runtime="));
if (runtimeArg) args.delete(runtimeArg);
const runtime = (runtimeArg?.slice("--runtime=".length) ?? "node") as CoreRuntimeFlavor;
if (runtime !== "node" && runtime !== "bun") throw new Error(`[CoreBuild] 未知 runtime: ${runtime}`);
if (legacyBundleNode && runtime !== "node") throw new Error("[CoreBuild] --bundle-node 仅适用于 Node");
const direttaVariantArg = [...args].find((arg) => arg.startsWith("--diretta-variant="));
if (direttaVariantArg) args.delete(direttaVariantArg);
if (args.size > 0) throw new Error(`[CoreBuild] 未知参数: ${[...args].join(" ")}`);
const release = readCoreReleaseMetadata();
const buildDate = resolveCoreBuildDate();
// 打包时刻一次性决定并下发，保证 stage 与 check 两步算出的产物名一致（秒级不会再漂）
const buildTime = resolveCoreBuildTime();
const sourceIdentity = resolveSourceIdentity(root);
const buildEnv = { ...process.env, ATOM_BUILD_DATE: buildDate, ATOM_BUILD_TIME: buildTime };

// native 构建很慢，身份不合格就在这里失败，不要等跑完再报同样的错
if (sourceIdentity && sourceIdentity.published !== true && !allowUnpublished) {
  throw new Error(unpublishedIdentityMessage(sourceIdentity));
}

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
if (runtime === "bun") {
  run("验证 Bun runtime", process.env.ATOM_BUN_BIN || "bun", ["--version"]);
}

run("构建 Core native release", bin("tsx"), [
  "scripts/atom/build-core-native.ts",
  ...(requireDiretta ? ["--require-diretta"] : []),
  ...(direttaVariantArg ? [direttaVariantArg] : []),
]);
// native 构建刚把变体写进 out/native/build.json：产物名必须与它一致，
// 因为 stage / check 两步也是从同一个文件重建文件名的。
const direttaVariant = readDirettaCpuVariantFromNativeBuild(root);
run("构建 Core JS", bin("vite"), ["build", "-c", "scripts/atom/vite.core.config.ts"]);
run("验收 Core plugin-host IPC", process.execPath, ["scripts/atom/check-core-plugin-host.mjs"]);
if (runtime === "bun") {
  run("验收 Bun plugin-host IPC", process.env.ATOM_BUN_BIN || "bun", [
    "scripts/atom/check-bun-plugin-ipc.ts",
  ]);
}
run("构建 Web Control", bin("vite"), ["build", "-c", "vite.config.ts"]);
run("审计 Core build", process.execPath, ["scripts/atom/check-core-build.mjs"]);
run(bundleRuntime ? "生成 bundled-runtime tar.gz" : "生成 system-runtime tar.gz", bin("tsx"), [
  "scripts/atom/stage-core-system.ts",
  "--archive",
  `--runtime=${runtime}`,
  ...(bundleRuntime ? ["--bundle-runtime"] : []),
  ...(allowUnpublished ? ["--allow-unpublished"] : []),
]);
run("验收最终 tar artifact", bin("tsx"), [
  "scripts/atom/check-core-artifact.ts",
  `--runtime=${runtime}`,
  ...(bundleRuntime ? ["--bundle-runtime"] : []),
]);

console.log(
  `[CoreBuild] PASS ${path.join(
    root,
    "out",
    coreArtifactFileName(
      bundleRuntime,
      release.version,
      sourceIdentity?.commit ?? "00000000",
      buildDate,
      buildTime,
      direttaVariant,
      runtime,
    ),
  )}`,
);
