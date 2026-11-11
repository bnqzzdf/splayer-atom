import { readFileSync } from "node:fs";
import path from "node:path";

export const DIRETTA_SDK_RELEASE = 148;
// SDK 静态库按 CPU 指令集分别发布，变体高于目标 CPU 会触发 SIGILL。
// SDK 148 的 x86-64 库只提供 v2/v3/v4/zen4，不能选择 v1；aarch64 使用单独的 arm64 库。
export const DIRETTA_CPU_VARIANTS = ["v2", "v3", "v4", "zen4"] as const;
export type DirettaX86CpuVariant = (typeof DIRETTA_CPU_VARIANTS)[number];
export type DirettaCpuVariant = DirettaX86CpuVariant | "arm64";

/**
 * 解析 Diretta CPU variant；arm64 只用于 aarch64 构建。
 * @param value - 命令行或环境变量中的 variant
 * @returns 受支持的 variant
 */
export const parseDirettaCpuVariant = (value: string): DirettaCpuVariant => {
  if (value === "arm64" || (DIRETTA_CPU_VARIANTS as readonly string[]).includes(value)) {
    return value as DirettaCpuVariant;
  }
  throw new Error(
    `不支持的 Diretta CPU variant: ${value}，可选值为 ${DIRETTA_CPU_VARIANTS.join(", ")}, arm64`,
  );
};

/**
 * 从 Diretta SDK 的公开 Release.hpp 读取 release 编号。
 * @param sdkRoot - Diretta Host SDK 根目录
 * @returns SDK release 编号
 */
export const readDirettaSdkRelease = (sdkRoot: string): number => {
  const releaseFile = path.join(sdkRoot, "Host", "Release.hpp");
  let source: string;
  try {
    source = readFileSync(releaseFile, "utf8");
  } catch (error) {
    throw new Error(`无法读取 Diretta SDK release metadata: ${releaseFile}`, { cause: error });
  }
  const match = source.match(/\bReleaseNo\s*=\s*(\d+)\s*;/);
  if (!match) {
    throw new Error(`无法识别 Diretta SDK release metadata: ${releaseFile}`);
  }
  return Number.parseInt(match[1], 10);
};
