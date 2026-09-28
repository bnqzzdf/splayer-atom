/**
 * 为文档统一写入/刷新「最后更新」时间戳。
 *
 * 为什么需要它：文档散在 50 多个文件里（`docs/**` + 两份 README），手工维护日期必然腐烂——
 * 要么忘记改，要么改了却与真实修订对不上。这里从 git 历史推导，保证可验证、可重跑。
 *
 * 取值规则：**最后一次「正文修订」的提交日期**。
 * 只改时间戳行本身的提交不算正文修订，否则会出现"改一次时间戳，日期就跳一次"的自激循环；
 * 实现上从最新提交往回找，逐个把时间戳行剥掉再比对，找到第一个正文与前一个版本不同的提交。
 *
 * 用法：
 *   pnpm docs:stamp          写入/刷新全部文档的时间戳
 *   pnpm docs:stamp --check  只检查，有过期就退出码 1（供发布门禁用）
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const checkOnly = process.argv.includes("--check");

/** 时间戳行：中英文文档各用一种文案 */
const STAMP_LINE = /^> (?:最后更新：|Last updated: )\d{4}-\d{2}-\d{2}$/;
/** 往回最多看几个提交，够用且不会把脚本拖慢 */
const MAX_COMMITS = 12;

const fail: (message: string) => never = (message) => {
  console.error(`[DocStamp] ${message}`);
  process.exit(1);
};

const git = (args: string[]): string => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) return "";
  return result.stdout ?? "";
};

/** 文档集合：docs/ 下全部 Markdown + 仓库根的两份 README */
const collectDocs = (): string[] => {
  const listed = git(["ls-files", "docs/*.md", "docs/**/*.md", "README.md", "README.en.md"]);
  return listed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
};

/** 去掉时间戳行后的正文，用于判断"这次提交是否动过正文" */
const withoutStamp = (text: string): string =>
  text
    .split("\n")
    .filter((line) => !STAMP_LINE.test(line.trim()))
    .join("\n");

const isEnglish = (file: string): boolean =>
  file.startsWith("docs/en/") || file.endsWith("README.en.md");

const stampLineFor = (file: string, date: string): string =>
  isEnglish(file) ? `> Last updated: ${date}` : `> 最后更新：${date}`;

/** 该文件最后一次正文修订的日期 */
const contentRevisionDate = (file: string): string => {
  const today = new Date().toISOString().slice(0, 10);
  // 工作树里有未提交的正文改动时按"今天"算：否则会出现"改完提交，时间戳才过期"的错位，
  // 逼着人再补一次提交。只改时间戳行本身不算正文改动（下面同样剥掉再比）。
  const head = git(["show", `HEAD:${file}`]);
  const working = readFileSync(path.join(root, file), "utf8");
  if (head && withoutStamp(head) !== withoutStamp(working)) return today;
  const entries = git(["log", `--max-count=${MAX_COMMITS}`, "--format=%H %cs", "--", file])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    // 尚未提交的新文档：用今天
    return new Date().toISOString().slice(0, 10);
  }
  const bodies = entries.map((entry) => {
    const sha = entry.split(" ")[0]!;
    return withoutStamp(git(["show", `${sha}:${file}`]));
  });
  // 从最新往回逐对比较：commit[i] 剥掉时间戳行后的正文若与上一个提交不同，
  // 则 commit[i] 就是最后一次正文修订（只改时间戳的提交在这里会被跳过）
  for (let i = 0; i < entries.length - 1; i += 1) {
    if (bodies[i] !== bodies[i + 1]) return entries[i]!.split(" ")[1]!;
  }
  // 往回看到底都没找到差异：退回最新提交日期
  return entries[0]!.split(" ")[1]!;
};

/** 把时间戳行插到 H1 之后（有 frontmatter 就跳过 frontmatter）；已有则就地替换 */
const applyStamp = (text: string, file: string, date: string): string => {
  const lines = text.split("\n");
  const stamp = stampLineFor(file, date);
  const existing = lines.findIndex((line) => STAMP_LINE.test(line.trim()));
  if (existing >= 0) {
    lines[existing] = stamp;
    return lines.join("\n");
  }

  // frontmatter：文件以 --- 开头时，跳过到第二个 ---
  let cursor = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.indexOf("---", 1);
    cursor = end > 0 ? end + 1 : 0;
  }
  // 跳过 frontmatter 后的空行，找 H1
  let h1 = -1;
  for (let i = cursor; i < lines.length; i += 1) {
    const trimmed = lines[i]!.trim();
    if (trimmed === "") continue;
    if (trimmed.startsWith("# ")) h1 = i;
    break;
  }
  const at = h1 >= 0 ? h1 + 1 : cursor;
  const rest = lines.slice(at);
  while (rest.length > 0 && rest[0]!.trim() === "") rest.shift();
  lines.splice(at, lines.length - at, "", stamp, "", ...rest);
  return lines.join("\n");
};

const docs = collectDocs();
if (docs.length === 0) fail("没有找到任何文档");

const stale: string[] = [];
const created: string[] = [];
for (const file of docs) {
  const absolute = path.join(root, file);
  const original = readFileSync(absolute, "utf8");
  const date = contentRevisionDate(file);
  const updated = applyStamp(original, file, date);
  if (updated === original) continue;
  const hadStamp = original.split("\n").some((line) => STAMP_LINE.test(line.trim()));
  (hadStamp ? stale : created).push(`${file} -> ${date}`);
  if (!checkOnly) writeFileSync(absolute, updated);
}

const total = stale.length + created.length;
if (checkOnly) {
  if (total === 0) {
    console.log(`[DocStamp] PASS ${docs.length} 份文档的时间戳都是最新的`);
  } else {
    console.error(`[DocStamp] ${total} 份文档的时间戳需要刷新：`);
    for (const line of [...created, ...stale]) console.error(`  ${line}`);
    console.error("[DocStamp] 运行 `pnpm docs:stamp` 刷新后重新提交");
    process.exit(1);
  }
} else {
  console.log(
    `[DocStamp] ${docs.length} 份文档：新增时间戳 ${created.length} 份，刷新 ${stale.length} 份`,
  );
  for (const line of [...created, ...stale]) console.log(`  ${line}`);
}
