/**
 * 源码交付包：把某个**已发布提交**的纯导出打成一个可独立构建的 tar.gz。
 *
 * 为什么需要它：`SOURCE_COMMIT` 的写入方原先在仓库外，没有任何东西保证它写进去的
 * 提交真实存在——历史上就出现过交付包自证 `42e380a1`、Core 产物自证 `5ae8d992`，
 * 这两个提交在共享仓库里都查不到，拿到包的人根本无法复现源码。
 * 把导出与自证搬进仓库后，写入端和构建端的校验共用 `sourceIdentity.ts` 的同一份格式，
 * 规则不会再两头漂。
 *
 * 产物名与历史交付保持一致：
 *   out/splayer-atom-dev-<version>-<短提交号>-src-<YYYYMMDD>-<HHMMSS>.tar.gz
 *   out/<同名>.sha256（旁挂校验值）
 *
 * 用法：`pnpm package:source`
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  readCoreReleaseMetadata,
  resolveCoreBuildDate,
  resolveCoreBuildTime,
  shortCoreCommit,
} from "./core-artifact-name";
import {
  renderSourceCommitFile,
  resolveSourceIdentity,
  SOURCE_COMMIT_FILE,
  unpublishedIdentityMessage,
} from "./sourceIdentity";

const root = fileURLToPath(new URL("../..", import.meta.url));
const args = new Set(process.argv.slice(2));
if (args.size > 0) throw new Error(`[SourcePkg] 未知参数: ${[...args].join(" ")}`);

const run = (
  label: string,
  command: string,
  commandArgs: string[],
  options: { cwd?: string } = {},
): string => {
  const result = spawnSync(command, commandArgs, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`[SourcePkg] ${label} 被信号终止: ${result.signal}`);
  if (result.status !== 0) {
    throw new Error(`[SourcePkg] ${label} 失败: ${(result.stderr ?? "").trim()}`);
  }
  return result.stdout ?? "";
};

// 交付包必须自证一个真实且已发布的提交；这两个前提不满足就没有打包的意义。
const identity = resolveSourceIdentity(root);
if (!identity) throw new Error("[SourcePkg] 无法确定源码身份，请在仓库工作树内执行");
if (identity.published !== true) throw new Error(unpublishedIdentityMessage(identity));
if (identity.dirty) {
  throw new Error("[SourcePkg] 工作树有未提交改动；交付包只从干净的提交导出");
}

const { version } = readCoreReleaseMetadata();
const buildDate = resolveCoreBuildDate();
const buildTime = resolveCoreBuildTime();
const shortCommit = shortCoreCommit(identity.commit);
const topDir = `splayer-atom-dev-${version}-${shortCommit}`;
const fileName = `${topDir}-src-${buildDate}-${buildTime}.tar.gz`;
const outDir = path.join(root, "out");
const archiveFile = path.join(outDir, fileName);
mkdirSync(outDir, { recursive: true });

// 与 Core 产物同一套约定：归档内文件时间戳锚定到打包日零点（本地时区），
// 于是同一个提交 + 同一个 ATOM_BUILD_DATE 能导出相同字节的包。
const archiveEpochSeconds = Math.floor(
  new Date(
    Number(buildDate.slice(0, 4)),
    Number(buildDate.slice(4, 6)) - 1,
    Number(buildDate.slice(6, 8)),
  ).getTime() / 1000,
);

// 内容取自**提交本身**而不是工作树：工作树可能带未跟踪产物，
// 那样导出的就不等于 SOURCE_COMMIT 自证的那个提交了。
const staging = mkdtempSync(path.join(tmpdir(), "atom-src-"));
try {
  const exportedTar = path.join(staging, "src.tar");
  run(
    "导出提交树",
    "git",
    ["archive", "--format=tar", `--prefix=${topDir}/`, "-o", exportedTar, identity.commit],
    { cwd: root },
  );
  run("解包导出树", "tar", ["-xf", exportedTar, "-C", staging]);
  // 写入端与解析端共用同一个渲染函数，格式不会两边漂
  writeFileSync(
    path.join(staging, topDir, SOURCE_COMMIT_FILE),
    renderSourceCommitFile(identity),
    "utf8",
  );
  run(
    "生成源码包",
    "tar",
    [
      "--sort=name",
      `--mtime=@${archiveEpochSeconds}`,
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "-czf",
      archiveFile,
      topDir,
    ],
    { cwd: staging },
  );
} finally {
  rmSync(staging, { recursive: true, force: true });
}

// 旁挂 sha256，格式与既有交付一致：`<hash>  <文件名>`
const digest = run("计算 sha256", "sha256sum", [fileName], { cwd: outDir }).split(/\s+/)[0];
writeFileSync(`${archiveFile}.sha256`, `${digest}  ${fileName}\n`, "utf8");

console.log(`[SourcePkg] PASS ${archiveFile}`);
console.log(
  `[SourcePkg] ${SOURCE_COMMIT_FILE}: commit=${shortCommit} ` +
    `date=${identity.date ?? "unknown"} remote=${identity.remote}`,
);
