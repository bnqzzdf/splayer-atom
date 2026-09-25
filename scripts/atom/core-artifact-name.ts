import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDirettaCpuVariant, type DirettaCpuVariant } from "./diretta-sdk";

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

/**
 * 产物文件名后缀：`[-diretta-<变体>]-<flavor>-linux-x64.tar.gz`。
 *
 * Diretta 变体必须进文件名：同一版本会为不同 CPU 代次各出一个 tar，
 * 名字里不带变体就无法判断「这个包能不能在手上这台机器跑」。
 * 不带 Diretta 的 ALSA-only 构建没有变体，后缀保持原样。
 *
 * @param bundleNode 是否内嵌 Node 运行时
 * @param direttaVariant Diretta CPU 变体；null 表示不带 Diretta
 */
export const coreArtifactSuffix = (
  bundleNode: boolean,
  direttaVariant: DirettaCpuVariant | null = null,
): string =>
  `${direttaVariant ? `-diretta-${direttaVariant}` : ""}-${bundleNode ? "bundled" : "system"}-linux-x64.tar.gz`;

/**
 * 从 `out/native/build.json` 读取本次 native 构建用的 Diretta CPU 变体。
 *
 * 产物名由 stage 与 check 两步各自重建，两边都必须拿到同一个变体，
 * 否则会算出两个不同的文件名。build.json 是 native 构建的落盘记录，
 * 是这条链上唯一的权威来源。
 *
 * @param repoRoot 仓库根目录
 * @returns 变体；ALSA-only 构建返回 null
 */
export const readDirettaCpuVariantFromNativeBuild = (
  repoRoot: string,
): DirettaCpuVariant | null => {
  const file = path.join(repoRoot, "out", "native", "build.json");
  if (!existsSync(file)) {
    throw new Error(`[CoreArtifact] 找不到 native build metadata: ${file}`);
  }
  const raw = JSON.parse(readFileSync(file, "utf8")) as { direttaCpuVariant?: unknown };
  const value = raw.direttaCpuVariant;
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new Error(`[CoreArtifact] build.json direttaCpuVariant 非法: ${String(value)}`);
  }
  return parseDirettaCpuVariant(value);
};

/** 产物名里使用的短提交号（8 位），只接受十六进制串 */
export const shortCoreCommit = (commit: string): string => {
  const value = commit.trim().toLowerCase();
  if (!/^[0-9a-f]{8,40}$/.test(value)) {
    throw new Error(`产物名需要合法的 commit，当前为 ${commit}`);
  }
  return value.slice(0, 8);
};

/**
 * 产物文件名：
 * `splayer-atom-core-<version>-<短提交号>-<YYYYMMDD>-<HHMMSS>[-diretta-<变体>]-<flavor>-linux-x64.tar.gz`
 *
 * 带上提交号，是为了让「拿到一个 tar 就能知道它是哪次提交构建的」——
 * 之前只能解包读 `runtime.json` 才知道，而文件名里的日期+时刻无法与提交对应。
 * 带上 Diretta 变体，是为了让「拿到一个 tar 就知道它能在哪代 CPU 上跑」。
 */
export const coreArtifactFileName = (
  bundleNode: boolean,
  version: string,
  commit: string,
  buildDate: string,
  buildTime: string,
  direttaVariant: DirettaCpuVariant | null = null,
): string =>
  `splayer-atom-core-${version}-${shortCoreCommit(commit)}-${buildDate}-${buildTime}${coreArtifactSuffix(bundleNode, direttaVariant)}`;

/**
 * 兜底发现：`out/` 下最新的同 flavor 产物。
 *
 * 正常流程里 build-core-system 会把打包时刻通过 ATOM_BUILD_DATE/ATOM_BUILD_TIME 传给子进程，
 * 各步骤算出的文件名一致；但单独运行 `check-core-artifact.ts`（或跨天复核）时
 * 无法重建出当初的秒级时刻，这时就退回「取最新的那个」。
 */
export const findLatestCoreArtifact = (
  repoRoot: string,
  bundleNode: boolean,
  direttaVariant: DirettaCpuVariant | null = null,
): string => {
  const outDir = path.join(repoRoot, "out");
  const suffix = coreArtifactSuffix(bundleNode, direttaVariant);
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
