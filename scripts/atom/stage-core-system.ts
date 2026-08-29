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
import { CORE_NODE_RANGE, CORE_NODE_REFERENCE } from "../../electron/main/atom/runtime/nodeRuntime";
import { CORE_PROTOCOL_VERSION } from "../../shared/constants/coreProtocol";

const root = fileURLToPath(new URL("../..", import.meta.url));
const outputDir = path.join(root, "out", "core-system");
const coreDir = path.join(root, "out", "core");
const rendererDir = path.join(root, "out", "renderer");
const nativeBuildFile = path.join(root, "out", "native", "build.json");
const audioEngineFile = path.join(root, "out", "native", "audio-engine.node");
const require = createRequire(import.meta.url);
const args = new Set(process.argv.slice(2));
const archive = args.delete("--archive");
if (args.size > 0) throw new Error(`[CoreStage] 未知参数: ${[...args].join(" ")}`);

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
requireFile(path.join(root, "LICENSE"), "AGPL license");

const nativeBuild = JSON.parse(readFileSync(nativeBuildFile, "utf8")) as {
  profile?: string;
  flavor?: string;
  platform?: string;
  arch?: string;
  diretta?: boolean;
};
if (nativeBuild.profile !== "release" || nativeBuild.flavor !== "core-audio") {
  fail(
    `system-runtime staging 只接受 release core-audio addon，当前为 ${nativeBuild.profile}/${nativeBuild.flavor}`,
  );
}
if (nativeBuild.platform !== "linux" || nativeBuild.arch !== "x64") {
  fail(`Core native build metadata 与 linux-x64 staging 不一致`);
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
cpSync(nativeBuildFile, path.join(outputDir, "native", "build.json"));
cpSync(path.join(root, "LICENSE"), path.join(outputDir, "LICENSE"));
mkdirSync(path.join(outputDir, "bin"), { recursive: true });
cpSync(
  path.join(root, "scripts", "atom", "core-system", "splayer-atom-core"),
  path.join(outputDir, "bin", "splayer-atom-core"),
);
chmodSync(path.join(outputDir, "bin", "splayer-atom-core"), 0o755);
mkdirSync(path.join(outputDir, "service"), { recursive: true });
cpSync(
  path.join(root, "scripts", "atom", "core-system", "splayer-atom-core.service"),
  path.join(outputDir, "service", "splayer-atom-core.service"),
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
      platform: "linux",
      arch: "x64",
      nodeRange: CORE_NODE_RANGE,
      nodeReference: CORE_NODE_REFERENCE,
      betterSqlite3: betterSqlitePackage.version ?? "unknown",
      protocolVersion: CORE_PROTOCOL_VERSION,
      capabilities: {
        library: true,
        playback: true,
        diretta: nativeBuild.diretta === true,
        netease: true,
        qobuz: true,
        tidal: true,
        remoteOutput: false,
      },
      diretta: nativeBuild.diretta === true,
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
console.log(JSON.stringify({ node: process.versions.node, sqlite: true, audioEngine: true }));
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
  const archiveFile = path.join(root, "out", "core-system-linux-x64.tar.gz");
  rmSync(archiveFile, { force: true });
  const tar = spawnSync(
    "tar",
    [
      "--sort=name",
      "--mtime=@0",
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
