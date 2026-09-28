import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const SYNC_SCRIPT = "scripts/atom/sync-doc-timestamps.ts";
const STAMP = /^> (?:最后更新：|Last updated: )(\d{4}-\d{2}-\d{2})$/;

const trackedDocs = (): string[] =>
  execFileSync("git", ["ls-files", "docs/*.md", "docs/**/*.md", "README.md", "README.en.md"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/**
 * 文档时间戳契约。
 *
 * 每份文档在 H1（或 frontmatter）之后、正文之前必须恰好有一行时间戳，
 * 且日期是真实存在的日期——它是从 git 的「最后一次正文修订」推导出来的，
 * 生成与校验都由 `scripts/atom/sync-doc-timestamps.ts` 负责（`pnpm docs:stamp`）。
 */
test("每份文档都有且只有一个格式正确、位置正确的最后更新时间戳", () => {
  const docs = trackedDocs();
  assert.ok(docs.length >= 40, `文档数量异常：${docs.length}`);
  const problems: string[] = [];
  for (const file of docs) {
    const lines = readFileSync(path.join(repoRoot, file), "utf8").split("\n");
    const hits = lines
      .map((line, index) => ({ line: line.trim(), index }))
      .filter((item) => STAMP.test(item.line));
    if (hits.length !== 1) {
      problems.push(`${file}: 时间戳行数 ${hits.length}`);
      continue;
    }
    const at = hits[0]!.index;
    const date = STAMP.exec(hits[0]!.line)![1]!;
    if (Number.isNaN(Date.parse(date))) problems.push(`${file}: 日期无法解析 ${date}`);
    // 位置：时间戳之前除了 frontmatter 与 H1 不应有正文
    const fmEnd = lines[0]?.trim() === "---" ? lines.indexOf("---", 1) + 1 : 0;
    const before = lines.slice(fmEnd, at).filter((line) => line.trim() !== "");
    if (before.length > 1 || (before.length === 1 && !before[0]!.startsWith("# "))) {
      problems.push(`${file}: 时间戳位置可疑（之前有正文：${JSON.stringify(before.slice(0, 2))}）`);
    }
  }
  assert.deepEqual(problems, [], `时间戳问题：\n${problems.join("\n")}`);
});

test("时间戳由 git 历史推导，脚本与 npm 脚本齐备", () => {
  const script = readFileSync(path.join(repoRoot, SYNC_SCRIPT), "utf8");
  assert.match(script, /const entries = git\(\["log",/);
  assert.match(script, /--max-count=\$\{MAX_COMMITS\}/);
  // 只改时间戳的提交不算正文修订（否则每刷一次日期就自激跳一次）
  assert.match(script, /const withoutStamp/);
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(pkg.scripts["docs:stamp"], `tsx ${SYNC_SCRIPT}`);
  assert.equal(pkg.scripts["docs:stamp:check"], `tsx ${SYNC_SCRIPT} --check`);
});
