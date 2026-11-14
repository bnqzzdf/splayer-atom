import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDateVersion } from "./core-artifact-name";

const root = fileURLToPath(new URL("../..", import.meta.url));

export const formatDateVersion = (date: Date): string =>
  `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;

export const parseBumpDateInput = (raw: string): string => {
  const normalized = raw.trim();
  const match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(normalized);
  if (!match) {
    throw new Error(`[ReleaseBump] 日期必须使用 YYYY-MM-DD 或 YYYYMMDD 格式，当前为 ${raw}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(year, month - 1, day);
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) {
    throw new Error(`[ReleaseBump] 无效日历日期: ${raw}`);
  }
  return `${year}.${month}.${day}`;
};

export const resolveNextDateVersion = (
  baseDateVersion: string,
  existingVersions: readonly string[],
): string => {
  if (!isDateVersion(baseDateVersion) || baseDateVersion.includes("-")) {
    throw new Error(`[ReleaseBump] 基础日期版本必须是 YYYY.M.D，当前为 ${baseDateVersion}`);
  }
  const escaped = baseDateVersion.replaceAll(".", "\\.");
  const matcher = new RegExp(`^${escaped}(?:-([1-9]\\d*))?$`);
  let maxRevision = -1;
  for (const candidate of existingVersions) {
    const trimmed = candidate.trim().replace(/^v/, "");
    const hit = matcher.exec(trimmed);
    if (!hit) continue;
    const revision = hit[1] ? Number(hit[1]) : 0;
    if (revision > maxRevision) maxRevision = revision;
  }
  return maxRevision < 0 ? baseDateVersion : `${baseDateVersion}-${maxRevision + 1}`;
};

const runGit = (gitArgs: string[]): { ok: boolean; out: string } => {
  const result = spawnSync("git", gitArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { ok: !result.error && !result.signal && result.status === 0, out };
};

// 同时检查本地与远端标签，防止本地尚未 fetch 时在同日重复生成已发布的版本号。
const collectKnownVersions = (baseDateVersion: string, currentVersion: string): string[] => {
  const versions = new Set<string>([currentVersion]);
  const localTags = runGit(["tag", "-l", `v${baseDateVersion}`, `v${baseDateVersion}-*`]);
  if (localTags.ok && localTags.out) {
    for (const line of localTags.out.split("\n")) {
      if (line.trim()) versions.add(line.trim());
    }
  }
  const remoteTags = runGit([
    "ls-remote",
    "--tags",
    "origin",
    `refs/tags/v${baseDateVersion}`,
    `refs/tags/v${baseDateVersion}-*`,
  ]);
  if (remoteTags.ok && remoteTags.out) {
    for (const line of remoteTags.out.split("\n")) {
      const ref = line.split(/\s+/)[1] ?? "";
      const tag = ref.replace(/^refs\/tags\//, "").replace(/\^\{\}$/, "");
      if (tag) versions.add(tag);
    }
  }
  return [...versions];
};

const main = (): void => {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.delete("--dry-run");
  const commit = args.delete("--commit");
  const dateArg = [...args].find((arg) => arg.startsWith("--date="));
  if (dateArg) args.delete(dateArg);
  if (args.size > 0) {
    throw new Error(`[ReleaseBump] 未知参数: ${[...args].join(" ")}`);
  }

  const explicitDate = dateArg?.slice("--date=".length) ?? process.env.ATOM_BUILD_DATE?.trim();
  const baseDateVersion = explicitDate
    ? parseBumpDateInput(explicitDate)
    : formatDateVersion(new Date());

  const pkgPath = path.join(root, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
  const currentVersion = pkg.version ?? "";
  const nextVersion = resolveNextDateVersion(
    baseDateVersion,
    collectKnownVersions(baseDateVersion, currentVersion),
  );

  if (dryRun) {
    console.log(`[ReleaseBump] 检查通过（--dry-run，未修改文件）`);
    console.log(`[ReleaseBump] ${currentVersion} -> ${nextVersion}`);
    return;
  }

  if (commit) {
    const status = runGit(["status", "--porcelain"]);
    if (!status.ok) throw new Error(`[ReleaseBump] 无法检查 git 状态: ${status.out}`);
    if (status.out.length > 0) {
      throw new Error(
        `[ReleaseBump] 使用 --commit 要求工作树干净，当前有未提交改动：\n${status.out}`,
      );
    }
  }

  pkg.version = nextVersion;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  console.log(`[ReleaseBump] package.json 版本已更新: ${currentVersion} -> ${nextVersion}`);

  if (commit) {
    const staged = runGit(["add", "package.json"]);
    if (!staged.ok) throw new Error(`[ReleaseBump] git add 失败: ${staged.out}`);
    const committed = runGit(["commit", "-m", `chore(release): 更新版本至 ${nextVersion}`]);
    if (!committed.ok) throw new Error(`[ReleaseBump] git commit 失败: ${committed.out}`);
    console.log(`[ReleaseBump] 已提交: chore(release): 更新版本至 ${nextVersion}`);
  } else {
    console.log(`[ReleaseBump] 下一步：提交改动并推送后运行 pnpm release:tag --push`);
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
