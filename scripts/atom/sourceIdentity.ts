/**
 * 构建身份解析（commit / dirty / date）。
 *
 * 为什么需要这个模块：`stage-core-system.ts` 必须把 commit 写进 runtime.json，
 * 而**源码交付包是纯导出、不含 `.git`**，所以只要构建环境没有 git 工作树，
 * staging 就会直接失败——交付包无法独立编译。
 *
 * 这里给出统一的回退链，并且**不伪造身份**：拿不到就返回 null，
 * 由调用方决定怎么报错；能拿到时 commit 一定来自真实来源。
 *
 * 优先级：
 *   1. `git rev-parse HEAD`（正常开发构建）
 *   2. `ATOM_COMMIT`（+ `ATOM_COMMIT_DIRTY` / `ATOM_COMMIT_DATE`）：CI 或无 git 的净室构建
 *   3. 包根目录的 `SOURCE_COMMIT` 文件：源码交付包自带，使交付包可独立编译
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** 身份来源，便于日志与排障。 */
export type SourceIdentityOrigin = "git" | "env" | "file";

export interface SourceIdentity {
  commit: string;
  dirty: boolean;
  /** ISO 时间；仅在能确定时给出（git 提交时间 / SOURCE_COMMIT 的 date 字段）。 */
  date?: string;
  origin: SourceIdentityOrigin;
}

/** 源码交付包携带的构建身份文件名（位于仓库 / 包根目录）。 */
export const SOURCE_COMMIT_FILE = "SOURCE_COMMIT";

const TRUTHY = new Set(["1", "true", "yes", "on"]);

const isTruthy = (value: string | undefined): boolean =>
  TRUTHY.has((value ?? "").trim().toLowerCase());

/** 仅接受看起来像 commit 的十六进制串，避免把垃圾写进 runtime.json。 */
const looksLikeCommit = (value: string): boolean => /^[0-9a-f]{7,64}$/i.test(value);

/** 在指定目录跑 git；任何失败都折叠成 null（缺 git / 非仓库 / 权限问题一视同仁）。 */
const runGit = (root: string, args: string[]): string | null => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error || result.signal || result.status !== 0) return null;
  return typeof result.stdout === "string" ? result.stdout.trim() : null;
};

/**
 * 解析 `SOURCE_COMMIT` 文件内容。
 *
 * 支持两种写法，注释行（`#` 开头）与空行忽略：
 * ```text
 * commit=<sha>
 * dirty=false
 * date=<iso>
 * ```
 * 或者只写一行裸 SHA。
 *
 * @param text 文件内容
 * @returns 解析结果；没有可用 commit 时返回 null
 */
export const parseSourceCommitFile = (
  text: string,
): { commit: string; dirty: boolean; date?: string } | null => {
  const fields = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    fields.set(line.slice(0, eq).trim().toLowerCase(), line.slice(eq + 1).trim());
  }

  const bare = text.trim();
  const fromField = (fields.get("commit") ?? "").trim();
  const commit = fromField || (looksLikeCommit(bare) ? bare : "");
  if (!commit || !looksLikeCommit(commit)) return null;

  const date = (fields.get("date") ?? "").trim();
  return {
    commit,
    dirty: isTruthy(fields.get("dirty")),
    ...(date ? { date } : {}),
  };
};

/**
 * 解析当前构建的源码身份。
 *
 * @param root 仓库 / 交付包根目录
 * @returns 构建身份；三条来源都不可用时返回 null
 */
export const resolveSourceIdentity = (root: string): SourceIdentity | null => {
  const head = runGit(root, ["rev-parse", "HEAD"]);
  if (head && looksLikeCommit(head)) {
    const status = runGit(root, ["status", "--porcelain", "--untracked-files=normal"]);
    const date = runGit(root, ["log", "-1", "--format=%cI"]);
    return {
      commit: head,
      // 取不到 status 时按 dirty 处理：宁可标记为脏，也不要谎称干净。
      dirty: status === null ? true : status.length > 0,
      ...(date ? { date } : {}),
      origin: "git",
    };
  }

  const envCommit = (process.env.ATOM_COMMIT ?? "").trim();
  if (envCommit && looksLikeCommit(envCommit)) {
    const envDate = (process.env.ATOM_COMMIT_DATE ?? "").trim();
    return {
      commit: envCommit,
      dirty: isTruthy(process.env.ATOM_COMMIT_DIRTY),
      ...(envDate ? { date: envDate } : {}),
      origin: "env",
    };
  }

  const file = path.join(root, SOURCE_COMMIT_FILE);
  if (existsSync(file)) {
    const parsed = parseSourceCommitFile(readFileSync(file, "utf8"));
    if (parsed) return { ...parsed, origin: "file" };
  }

  return null;
};

/** 三条来源都不可用时的统一报错文案。 */
export const sourceIdentityFailureMessage = (): string =>
  "无法确定 Atom commit：既不在 git 工作树内，也没有 ATOM_COMMIT 环境变量，" +
  `也没有包根目录的 ${SOURCE_COMMIT_FILE} 文件。请在仓库内构建，` +
  `或为源码交付包生成 ${SOURCE_COMMIT_FILE}（打脚本已自动生成）。`;
