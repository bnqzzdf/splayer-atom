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
 *
 * **真实性规则**：写进产物名与 `runtime.json` 的提交必须是「真实存在」的提交——
 * 不只是长得像十六进制串，还得是该仓库里真实存在的 commit 对象，且在发布构建里
 * 已经推到**网络远端**（`published`）。历史事故：构建机把参考仓库锚定到一个只存在于
 * 本地的分支，产物名与 `runtime.json` 因此带上了一个远端查不到的提交，
 * 拿到包的人无法按提交复现源码。这里的 `published` 就是用来拦住这种情况的。
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
  /**
   * 该提交是否已发布到**网络远端**（别人能取到）。
   *
   * - `true`：可达某个远端跟踪分支，且该远端的 URL 是网络地址；
   * - `false`：明确可达的远端只有本地路径 / `file://` 仓库，或 `SOURCE_COMMIT`
   *   声明了 `published=true` 但 `remote=` 不是网络地址；
   * - `undefined`：当前环境判不出来（`ATOM_COMMIT` 环境变量、或 `SOURCE_COMMIT`
   *   没写 `published` 字段）。发布构建不接受 `undefined`。
   */
  published: boolean | undefined;
  /**
   * 承载 `published` 判定的网络远端地址。
   *
   * 生成源码交付包时必须把它写进 `SOURCE_COMMIT` 的 `remote=`：写入端与校验端
   * 必须看到同一个地址，否则交付包会自证一个构建端不认的远端。
   */
  remote?: string;
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
 * 远端 URL 是否是「别人也能取到」的网络地址。
 *
 * 本地路径（`/srv/git/x.git`、`../x`）与 `file://` 一律不算：把参考仓库锚定到
 * 本地路径时，提交只存在于构建机上，产物名里的提交号对外界毫无意义。
 */
const isNetworkRemoteUrl = (url: string): boolean =>
  /^(?:https?|ssh|git):\/\//i.test(url) || /^[^\s/@]+@[^\s:]+:/i.test(url);

/** 该提交在当前仓库里是否真实存在（不只是长得像 SHA）。 */
const commitExistsInRepo = (root: string, commit: string): boolean =>
  runGit(root, ["cat-file", "-e", `${commit}^{commit}`]) !== null;

/**
 * 找到第一个**网络远端**上包含该提交的远端地址。
 *
 * 只看 `refs/remotes/`：本地分支上的提交可能从未推送，正是历史上出问题的形态。
 * 返回 null 表示没有网络远端包含它，即未发布。
 */
const resolvePublishedRemote = (root: string, commit: string): string | null => {
  const refs = runGit(root, [
    "for-each-ref",
    `--contains=${commit}`,
    "--format=%(refname)",
    "refs/remotes/",
  ]);
  if (!refs) return null;
  for (const line of refs.split("\n")) {
    const ref = line.trim();
    if (!ref.startsWith("refs/remotes/")) continue;
    const remote = ref.slice("refs/remotes/".length).split("/")[0];
    // `refs/remotes/origin/HEAD` 指向的仍是同一个远端，按远端名归并即可
    if (!remote) continue;
    const url = runGit(root, ["remote", "get-url", remote]);
    if (url && isNetworkRemoteUrl(url)) return url;
  }
  return null;
};

/**
 * 解析 `SOURCE_COMMIT` 文件内容。
 *
 * 支持两种写法，注释行（`#` 开头）与空行忽略：
 * ```text
 * commit=<sha>
 * dirty=false
 * date=<iso>
 * remote=https://github.com/<owner>/<repo>.git
 * published=true
 * ```
 * 或者只写一行裸 SHA。
 *
 * `remote` / `published` 是可选的：只写 `published=true` 而不给出**网络** `remote`
 * 时按未发布处理——交付包无法自证提交已推送，就不能拿它当发布身份。
 *
 * @param text 文件内容
 * @returns 解析结果；没有可用 commit 时返回 null
 */
export const parseSourceCommitFile = (
  text: string,
): { commit: string; dirty: boolean; date?: string; published?: boolean } | null => {
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
  const declaredPublished = fields.get("published");
  const remote = (fields.get("remote") ?? "").trim();
  return {
    commit,
    dirty: isTruthy(fields.get("dirty")),
    ...(date ? { date } : {}),
    // 未声明时留空，交给调用方按「判不出来」处理，不要默认成已发布
    ...(declaredPublished === undefined
      ? {}
      : { published: isTruthy(declaredPublished) && isNetworkRemoteUrl(remote) }),
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
  // 只有真实存在的 commit 对象才作数：HEAD 指向损坏 / 未落盘对象时不采信
  if (head && looksLikeCommit(head) && commitExistsInRepo(root, head)) {
    const status = runGit(root, ["status", "--porcelain", "--untracked-files=normal"]);
    const date = runGit(root, ["log", "-1", "--format=%cI"]);
    const remote = resolvePublishedRemote(root, head);
    return {
      commit: head,
      // 取不到 status 时按 dirty 处理：宁可标记为脏，也不要谎称干净。
      dirty: status === null ? true : status.length > 0,
      ...(date ? { date } : {}),
      origin: "git",
      published: remote !== null,
      ...(remote ? { remote } : {}),
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
      // 环境变量只给了 SHA，没有可核对的仓库：判不出来
      published: undefined,
    };
  }

  const file = path.join(root, SOURCE_COMMIT_FILE);
  if (existsSync(file)) {
    const parsed = parseSourceCommitFile(readFileSync(file, "utf8"));
    if (parsed) {
      const { published, ...rest } = parsed;
      return { ...rest, origin: "file", published };
    }
  }

  return null;
};

/** 三条来源都不可用时的统一报错文案。 */
export const sourceIdentityFailureMessage = (): string =>
  "无法确定 Atom commit：既不在 git 工作树内，也没有 ATOM_COMMIT 环境变量，" +
  `也没有包根目录的 ${SOURCE_COMMIT_FILE} 文件。请在仓库内构建，` +
  `或为源码交付包生成 ${SOURCE_COMMIT_FILE}（打脚本已自动生成）。`;

/**
 * 身份存在但不能作为发布身份的报错文案。
 *
 * 说清「为什么」而不是只报错：这个检查是为了让产物可追溯，
 * 遇到它的人需要知道该推提交还是该补 `SOURCE_COMMIT` 字段。
 */
export const unpublishedIdentityMessage = (identity: SourceIdentity): string => {
  const short = identity.commit.slice(0, 8);
  const head =
    `[CoreStage] Atom commit ${short} 不是已发布的提交（来源=${identity.origin}）。` +
    `产物名与 runtime.json 里的提交必须能在共享仓库里查到，否则拿到包的人无法按提交复现源码。`;
  if (identity.origin === "file") {
    return (
      `${head} 请在 ${SOURCE_COMMIT_FILE} 里写 remote=<网络仓库地址> 与 published=true，` +
      `并确认该提交确实已推到那个远端。`
    );
  }
  if (identity.origin === "env") {
    return `${head} ATOM_COMMIT 无法自证已推送；发布构建请改用带 remote/published 的 ${SOURCE_COMMIT_FILE}。`;
  }
  return `${head} 请先把该提交推到网络远端（本地路径的参考仓库不算），再重新打包。`;
};

/**
 * 生成 `SOURCE_COMMIT` 内容。
 *
 * 写入端与解析端共用同一份格式：`parseSourceCommitFile(renderSourceCommitFile(x))`
 * 必须还原出 `x`，否则交付包会被构建端自己的身份文件挡住。
 * 没有网络远端时直接拒绝生成——写不出 `remote=` 的包自证不了提交已发布。
 *
 * @param identity 构建身份；需要 `remote` 是网络地址
 * @returns 文件内容（以换行结尾）
 */
export const renderSourceCommitFile = (identity: SourceIdentity): string => {
  const remote = identity.remote;
  if (!remote || !isNetworkRemoteUrl(remote)) {
    throw new Error(
      `生成 ${SOURCE_COMMIT_FILE} 需要网络远端地址，当前为 ${remote || "空"}；` +
        `本地路径远端无法自证提交已推送。`,
    );
  }
  return [
    "# 源码交付包自带的构建身份。",
    "# 使本包在没有 .git 的环境下也能独立构建：scripts/atom/stage-core-system.ts",
    "# 与 vite.config.ts 会读取本文件（见 scripts/atom/sourceIdentity.ts）。",
    "# 由打包脚本生成，请勿手工修改。",
    `commit=${identity.commit}`,
    `dirty=${identity.dirty}`,
    ...(identity.date ? [`date=${identity.date}`] : []),
    `remote=${remote}`,
    "published=true",
    "",
  ].join("\n");
};
