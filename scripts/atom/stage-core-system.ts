import { createRequire } from "node:module";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CONFIG_SCHEMA_VERSION } from "../../core/atom/runtime/configSchema";
import { CORE_NODE_RANGE, CORE_NODE_REFERENCE } from "../../core/atom/runtime/nodeRuntime";
import { DATABASE_SCHEMA_VERSION } from "../../core/database/migration";
import { CORE_PROTOCOL_VERSION } from "../../shared/constants/coreProtocol";
import { MANAGED_PROVIDER_PLATFORMS } from "../../shared/types/apis";
import {
  coreArtifactFileName,
  formatCoreBuildDate,
  readCoreReleaseMetadata,
  resolveCoreBuildDate,
  resolveCoreBuildTime,
} from "./core-artifact-name";
import { DIRETTA_SDK_RELEASE } from "./diretta-sdk";

const root = fileURLToPath(new URL("../..", import.meta.url));
const outputDir = path.join(root, "out", "core-system");
const coreDir = path.join(root, "out", "core");
const rendererDir = path.join(root, "out", "renderer");
const nativeBuildFile = path.join(root, "out", "native", "build.json");
const audioEngineFile = path.join(root, "out", "native", "audio-engine.node");
const streamingApiFile = path.join(root, "out", "native", "streaming-api.node");
const require = createRequire(import.meta.url);
const args = new Set(process.argv.slice(2));
const archive = args.delete("--archive");
const bundleNode = args.delete("--bundle-node");
if (args.size > 0) throw new Error(`[CoreStage] 未知参数: ${[...args].join(" ")}`);
const packageMetadata = readCoreReleaseMetadata();
const buildDate = resolveCoreBuildDate();
const buildTime = resolveCoreBuildTime();

/**
 * 归档内文件时间戳锚定到「打包日 00:00（构建环境本地时区）」。
 *
 * 之前用的是 `--mtime=@0`，解包后所有文件都显示 1970-01-01，带来三个实际问题：
 * - `rsync -a` / `tar --compare` 这类按 mtime 判断的工具，遇到**大小相同**的改动文件
 *   会误判为未变化而跳过；
 * - 非内容哈希命名的静态资源（renderer/images、fonts、icons）会带
 *   `Last-Modified: 1970`，可能被浏览器当作未更新而返回旧内容；
 * - 运维无法判断某次部署究竟更新了哪些文件。
 *
 * 用**本地零点**而不是打包时刻，是为了保留「同一个 ATOM_BUILD_DATE 能复现出相同字节」
 * 这一性质——runtime.json 的 buildDate 与产物文件名本来也按日锚定；
 * 用本地时区而不是 UTC，则是为了让解包后 `ls` 显示的日期与打包当天一致
 * （否则 CST 下会显示成当天 08:00，东八区以外的偏移更难看懂）。
 */
const archiveEpochSeconds = Math.floor(
  new Date(
    Number(buildDate.slice(0, 4)),
    Number(buildDate.slice(4, 6)) - 1,
    Number(buildDate.slice(6, 8)),
  ).getTime() / 1000,
);

// 显式标注类型：只有 const 带显式类型注解时，TS 才会把对它的调用视为 never，
// 从而在 `if (!x) fail(...)` 之后正确收窄。

const fail = (message: string): never => {
  throw new Error(`[CoreStage] ${message}`);
};

const requireFile = (file: string, description: string): void => {
  if (!existsSync(file)) fail(`${description} 不存在: ${file}`);
};

const requireDir = (dir: string, description: string): void => {
  if (!existsSync(dir)) fail(`${description} 不存在: ${dir}`);
};

if (process.versions.node !== CORE_NODE_REFERENCE) {
  fail(
    `system-runtime staging 必须使用 reference Node ${CORE_NODE_REFERENCE}，当前为 ${process.versions.node}`,
  );
}
if (process.platform !== "linux" || process.arch !== "x64") {
  fail(`首个正式 Core staging 仅支持 linux-x64，当前为 ${process.platform}-${process.arch}`);
}

requireDir(coreDir, "Core JS build");
requireDir(rendererDir, "Web renderer build");
requireFile(nativeBuildFile, "Core native build metadata");
requireFile(audioEngineFile, "Core audio-engine addon");
requireFile(streamingApiFile, "Core streaming-api addon");
requireFile(path.join(root, "LICENSE"), "AGPL license");

const gitHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
if (gitHead.error) throw gitHead.error;
if (gitHead.status !== 0 || gitHead.signal || !gitHead.stdout.trim()) {
  fail(`无法读取 Atom commit: ${`${gitHead.stdout ?? ""}${gitHead.stderr ?? ""}`.trim()}`);
}
const atomCommit = gitHead.stdout.trim();
const gitStatus = spawnSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
  cwd: root,
  encoding: "utf8",
});
if (gitStatus.error) throw gitStatus.error;
if (gitStatus.status !== 0 || gitStatus.signal) fail("无法读取 Atom worktree 状态");
const sourceDirty = gitStatus.stdout.trim().length > 0;

const nativeBuild = JSON.parse(readFileSync(nativeBuildFile, "utf8")) as {
  profile?: string;
  flavor?: string;
  platform?: string;
  arch?: string;
  modules?: string[];
  diretta?: boolean;
  direttaSdkRelease?: number | null;
  direttaCpuVariant?: "v2" | "v3" | "v4" | null;
};
if (nativeBuild.profile !== "release" || nativeBuild.flavor !== "core-audio") {
  fail(
    `system-runtime staging 只接受 release core-audio addon，当前为 ${nativeBuild.profile}/${nativeBuild.flavor}`,
  );
}
if (nativeBuild.platform !== "linux" || nativeBuild.arch !== "x64") {
  fail(`Core native build metadata 与 linux-x64 staging 不一致`);
}
if (
  !Array.isArray(nativeBuild.modules) ||
  !nativeBuild.modules.includes("audio-engine") ||
  !nativeBuild.modules.includes("streaming-api")
) {
  fail("Core native build metadata 缺少 audio-engine 或 streaming-api");
}
if (nativeBuild.diretta === true && nativeBuild.direttaSdkRelease !== DIRETTA_SDK_RELEASE) {
  fail(
    `Diretta Core artifact 必须使用 SDK ${DIRETTA_SDK_RELEASE}，当前为 ${nativeBuild.direttaSdkRelease ?? "unknown"}`,
  );
}
if (nativeBuild.diretta === true && !nativeBuild.direttaCpuVariant) {
  fail("Diretta Core artifact 必须记录 CPU variant");
}
if (nativeBuild.diretta !== true && nativeBuild.direttaSdkRelease != null) {
  fail(`no-Diretta Core native metadata 不应携带 SDK release`);
}
if (nativeBuild.diretta !== true && nativeBuild.direttaCpuVariant != null) {
  fail(`no-Diretta Core native metadata 不应携带 CPU variant`);
}

const betterSqlitePackageFile = require.resolve("better-sqlite3/package.json");
const betterSqliteDir = path.dirname(betterSqlitePackageFile);
const betterSqlitePackage = JSON.parse(readFileSync(betterSqlitePackageFile, "utf8")) as {
  version?: string;
};
const betterSqlitePrebuild = path.join(betterSqliteDir, "prebuilds", "linux-x64.node");
requireFile(betterSqlitePrebuild, "better-sqlite3 linux-x64 N-API prebuild");

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(path.join(outputDir, "data"), { recursive: true });
cpSync(coreDir, path.join(outputDir, "app"), { recursive: true });
cpSync(rendererDir, path.join(outputDir, "renderer"), { recursive: true });
mkdirSync(path.join(outputDir, "native"), { recursive: true });
cpSync(audioEngineFile, path.join(outputDir, "native", "audio-engine.node"));
cpSync(streamingApiFile, path.join(outputDir, "native", "streaming-api.node"));
cpSync(nativeBuildFile, path.join(outputDir, "native", "build.json"));
cpSync(path.join(root, "LICENSE"), path.join(outputDir, "LICENSE"));
mkdirSync(path.join(outputDir, "bin"), { recursive: true });
cpSync(
  path.join(root, "scripts", "atom", "core-system", "splayer-atom-core"),
  path.join(outputDir, "bin", "splayer-atom-core"),
);
chmodSync(path.join(outputDir, "bin", "splayer-atom-core"), 0o755);
if (bundleNode) {
  const bundledNode = path.join(outputDir, "runtime", "bin", "node");
  const nodeLicense = path.resolve(path.dirname(process.execPath), "..", "LICENSE");
  requireFile(nodeLicense, "bundled Node license");
  mkdirSync(path.dirname(bundledNode), { recursive: true });
  cpSync(process.execPath, bundledNode);
  chmodSync(bundledNode, 0o755);
  cpSync(nodeLicense, path.join(outputDir, "runtime", "LICENSE"));
}
mkdirSync(path.join(outputDir, "service"), { recursive: true });
cpSync(
  path.join(root, "scripts", "atom", "core-system", "splayer-atom-core.service"),
  path.join(outputDir, "service", "splayer-atom-core.service"),
);
cpSync(
  path.join(root, "scripts", "atom", "core-system", "install-systemd.sh"),
  path.join(outputDir, "service", "install-systemd.sh"),
);
chmodSync(path.join(outputDir, "service", "install-systemd.sh"), 0o755);
mkdirSync(path.join(outputDir, "docs"), { recursive: true });
cpSync(
  path.join(root, "docs", "core-deployment.md"),
  path.join(outputDir, "docs", "core-deployment.md"),
);

const stagedBetterSqlite = path.join(outputDir, "node_modules", "better-sqlite3");
mkdirSync(path.join(stagedBetterSqlite, "prebuilds"), { recursive: true });
cpSync(path.join(betterSqliteDir, "lib"), path.join(stagedBetterSqlite, "lib"), {
  recursive: true,
});
cpSync(betterSqlitePackageFile, path.join(stagedBetterSqlite, "package.json"));
cpSync(path.join(betterSqliteDir, "LICENSE"), path.join(stagedBetterSqlite, "LICENSE"));
cpSync(betterSqlitePrebuild, path.join(stagedBetterSqlite, "prebuilds", "linux-x64.node"));

writeFileSync(
  path.join(outputDir, "runtime.json"),
  `${JSON.stringify(
    {
      productName: packageMetadata.productName,
      atomVersion: packageMetadata.version,
      buildDate: formatCoreBuildDate(buildDate),
      atomCommit,
      sourceDirty,
      platform: "linux",
      arch: "x64",
      nodeRange: CORE_NODE_RANGE,
      nodeReference: CORE_NODE_REFERENCE,
      nodeBundled: bundleNode,
      betterSqlite3: betterSqlitePackage.version ?? "unknown",
      protocolVersion: CORE_PROTOCOL_VERSION,
      dataSchema: {
        database: DATABASE_SCHEMA_VERSION,
        config: CONFIG_SCHEMA_VERSION,
      },
      capabilities: {
        library: true,
        playback: true,
        download: true,
        diretta: nativeBuild.diretta === true,
        ...Object.fromEntries(MANAGED_PROVIDER_PLATFORMS.map((platform) => [platform, true])),
        remoteOutput: false,
      },
      diretta: nativeBuild.diretta === true,
      direttaSdkRelease: nativeBuild.direttaSdkRelease ?? null,
      direttaCpuVariant: nativeBuild.direttaCpuVariant ?? null,
    },
    null,
    2,
  )}\n`,
);

const smokeSource = `
const Database = require("better-sqlite3");
const db = new Database(":memory:");
if (db.prepare("select 1 as value").get().value !== 1) process.exit(2);
db.close();
const audioEngine = require("./native/audio-engine.node");
if (typeof audioEngine.AudioPlayer !== "function") process.exit(3);
const streamingApi = require("./native/streaming-api.node");
if (typeof streamingApi.callStreamingProvider !== "function") process.exit(4);
console.log(JSON.stringify({
  node: process.versions.node,
  sqlite: true,
  audioEngine: true,
  streamingApi: true,
}));
`;
const smoke = spawnSync(process.execPath, ["-e", smokeSource], {
  cwd: outputDir,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
if (smoke.status !== 0 || smoke.signal) {
  const detail = `${smoke.stdout ?? ""}${smoke.stderr ?? ""}`.trim();
  fail(`staged native smoke 失败${detail ? `: ${detail}` : ""}`);
}

console.log(`[CoreStage] PASS ${outputDir}`);
console.log(smoke.stdout.trim());

if (archive) {
  const archiveFile = path.join(
    root,
    "out",
    coreArtifactFileName(bundleNode, packageMetadata.version, buildDate, buildTime),
  );
  rmSync(archiveFile, { force: true });
  const tar = spawnSync(
    "tar",
    [
      "--sort=name",
      `--mtime=@${archiveEpochSeconds}`,
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "-czf",
      archiveFile,
      "core-system",
    ],
    { cwd: path.join(root, "out"), encoding: "utf8" },
  );
  if (tar.error) throw tar.error;
  if (tar.status !== 0 || tar.signal) {
    fail(`tar.gz 生成失败: ${`${tar.stdout ?? ""}${tar.stderr ?? ""}`.trim()}`);
  }
  console.log(`[CoreStage] ARCHIVE ${archiveFile}`);
}
