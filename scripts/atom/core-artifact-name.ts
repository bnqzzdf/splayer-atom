import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

type PackageReleaseMetadata = {
  productName?: string;
  version?: string;
};

export const readCoreReleaseMetadata = (): { productName: string; version: string } => {
  const metadata = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  ) as PackageReleaseMetadata;
  if (metadata.productName !== "SPlayer Atom" || !metadata.version) {
    throw new Error("package.json 缺少 SPlayer Atom 产品名称或版本号");
  }
  return { productName: metadata.productName, version: metadata.version };
};

const pad2 = (value: number): string => String(value).padStart(2, "0");

export const resolveCoreBuildDate = (
  explicit = process.env.ATOM_BUILD_DATE?.trim(),
  now = new Date(),
): string => {
  const value = explicit || `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  if (!/^\d{8}$/.test(value)) {
    throw new Error(`ATOM_BUILD_DATE 必须使用 YYYYMMDD 格式，当前为 ${value}`);
  }
  return value;
};

export const formatCoreBuildDate = (value: string): string =>
  `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;

/**
 * 解析打包时刻 `HHMMSS`。
 *
 * 只用于**产物文件名**，所以不影响内容可复现性：`runtime.json` 仍只记录 `buildDate`，
 * 「设置 ATOM_BUILD_DATE 即可复现出相同字节」这条契约保持不变。
 * 需要连文件名也复现时，额外设置 `ATOM_BUILD_TIME=HHMMSS` 即可。
 */
export const resolveCoreBuildTime = (
  explicit = process.env.ATOM_BUILD_TIME?.trim(),
  now = new Date(),
): string => {
  const value =
    explicit || `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  if (!/^\d{6}$/.test(value)) {
    throw new Error(`ATOM_BUILD_TIME 必须使用 HHMMSS 格式，当前为 ${value}`);
  }
  return value;
};

/** 产物文件名后缀：`-<flavor>-linux-x64.tar.gz` */
export const coreArtifactSuffix = (bundleNode: boolean): string =>
  `-${bundleNode ? "bundled" : "system"}-linux-x64.tar.gz`;

/** 产物名里使用的短提交号（8 位），只接受十六进制串 */
export const shortCoreCommit = (commit: string): string => {
  const value = commit.trim().toLowerCase();
  if (!/^[0-9a-f]{8,40}$/.test(value)) {
    throw new Error(`产物名需要合法的 commit，当前为 ${commit}`);
  }
  return value.slice(0, 8);
};

/**
 * 产物文件名：`splayer-atom-core-<version>-<短提交号>-<YYYYMMDD>-<HHMMSS>-<flavor>-linux-x64.tar.gz`
 *
 * 带上提交号，是为了让「拿到一个 tar 就能知道它是哪次提交构建的」——
 * 之前只能解包读 `runtime.json` 才知道，而文件名里的日期+时刻无法与提交对应。
 */
export const coreArtifactFileName = (
  bundleNode: boolean,
  version: string,
  commit: string,
  buildDate: string,
  buildTime: string,
): string =>
  `splayer-atom-core-${version}-${shortCoreCommit(commit)}-${buildDate}-${buildTime}${coreArtifactSuffix(bundleNode)}`;

/**
 * 兜底发现：`out/` 下最新的同 flavor 产物。
 *
 * 正常流程里 build-core-system 会把打包时刻通过 ATOM_BUILD_DATE/ATOM_BUILD_TIME 传给子进程，
 * 各步骤算出的文件名一致；但单独运行 `check-core-artifact.ts`（或跨天复核）时
 * 无法重建出当初的秒级时刻，这时就退回「取最新的那个」。
 */
export const findLatestCoreArtifact = (repoRoot: string, bundleNode: boolean): string => {
  const outDir = path.join(repoRoot, "out");
  const suffix = coreArtifactSuffix(bundleNode);
  if (!existsSync(outDir)) {
    throw new Error(`[CoreArtifact] 产物目录不存在: ${outDir}`);
  }
  const matches = readdirSync(outDir).filter(
    (name) => name.startsWith("splayer-atom-core-") && name.endsWith(suffix),
  );
  if (matches.length === 0) {
    throw new Error(`[CoreArtifact] out/ 下没有匹配的产物: *${suffix}`);
  }
  matches.sort(
    (a, b) => statSync(path.join(outDir, b)).mtimeMs - statSync(path.join(outDir, a)).mtimeMs,
  );
  return path.join(outDir, matches[0]);
};
