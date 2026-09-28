/**
 * 发布标签：只打 `v<version>`，只指向已发布的真实提交。
 *
 * 为什么不把构建身份写进标签名：历史标签形如
 * `1.1.1-5ae8d992-20260925-091129`——名字里的 `5ae8d992` 来自构建机本地分支的提交，
 * 标签实际却指向 `dev` 的另一个提交。名字与被指对象不一致，按标签名反查发布代码
 * 会得到错误答案；那个 `5ae8d992` 在共享仓库里根本不存在。
 *
 * 现在标签名只表达「哪一版」，提交由标签自身指向，两者永远是同一件事。
 * 产物名里的提交号仍由构建身份决定，但它是产物的属性，不再当作标签名。
 *
 * 用法：
 *   pnpm release:tag             打本地标签并打印推送命令
 *   pnpm release:tag --push      打标签并推送
 *   pnpm release:tag --dry-run   只做检查，不落标签
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readCoreReleaseMetadata } from "./core-artifact-name";
import { resolveSourceIdentity, unpublishedIdentityMessage } from "./sourceIdentity";

const root = fileURLToPath(new URL("../..", import.meta.url));
const args = new Set(process.argv.slice(2));
const push = args.delete("--push");
const dryRun = args.delete("--dry-run");
if (args.size > 0) throw new Error(`[ReleaseTag] 未知参数: ${[...args].join(" ")}`);

// 显式标注类型：只有 const 带显式类型注解时，TS 才会把对它的调用视为 never，
// 从而在 `if (!identity) fail(...)` 之后正确收窄。
const fail: (message: string) => never = (message) => {
  throw new Error(`[ReleaseTag] ${message}`);
};

const git = (gitArgs: string[]): { ok: boolean; out: string } => {
  const result = spawnSync("git", gitArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { ok: !result.error && !result.signal && result.status === 0, out };
};

// 标签必须指向真实且已发布的提交：这是它唯一的价值来源。
const identity = resolveSourceIdentity(root);
if (!identity) fail("无法确定源码身份，请在仓库工作树内执行");
if (identity.published !== true) fail(unpublishedIdentityMessage(identity));
if (identity.dirty) {
  const status = git(["status", "--short"]);
  fail(`工作树有未提交改动，发布标签只能指向干净的提交：\n${status.out}`);
}

const { version } = readCoreReleaseMetadata();
const tagName = `v${version}`;
const shortCommit = identity.commit.slice(0, 8);

const existingLocal = git(["rev-parse", "-q", "--verify", `refs/tags/${tagName}`]);
if (existingLocal.ok) {
  fail(
    `标签 ${tagName} 已存在（指向 ${existingLocal.out.slice(0, 8)}）。` +
      `若要重打，先删除：git tag -d ${tagName}`,
  );
}

// 远端已存在同名标签时直接停手：移动一个已发布的标签会让两边的 v<version> 指不同提交。
const existingRemote = git(["ls-remote", "--tags", "origin", `refs/tags/${tagName}`]);
if (existingRemote.ok && existingRemote.out.length > 0) {
  fail(`远端已有标签 ${tagName}：${existingRemote.out.split("\n")[0]}。版本号需要往上走。`);
}

if (dryRun) {
  console.log(`[ReleaseTag] 检查通过（--dry-run，未落标签）`);
  console.log(`[ReleaseTag] 目标: ${tagName} -> ${shortCommit} (${identity.date ?? "未知日期"})`);
} else {
  const created = git(["tag", tagName, identity.commit]);
  if (!created.ok) fail(`创建标签失败: ${created.out}`);
  console.log(
    `[ReleaseTag] 已创建标签 ${tagName} -> ${shortCommit} (${identity.date ?? "未知日期"})`,
  );

  if (push) {
    const pushed = git(["push", "origin", `refs/tags/${tagName}`]);
    if (!pushed.ok) fail(`推送标签失败: ${pushed.out}`);
    console.log(`[ReleaseTag] 已推送 ${tagName} 到 origin`);
  } else {
    console.log(`[ReleaseTag] 推送：git push origin refs/tags/${tagName}`);
  }
}
