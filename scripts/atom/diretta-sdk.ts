import { readFileSync } from "node:fs";
import path from "node:path";

export const DIRETTA_SDK_RELEASE = 148;
// SDK 静态库按 CPU 指令集分别发布，变体高于目标 CPU 会触发 SIGILL。
// SDK 148 只提供 v2/v3/v4/zen4，带 Diretta 的产物不能选择 v1。
export const DIRETTA_CPU_VARIANTS = ["v2", "v3", "v4", "zen4"] as const;
export type DirettaCpuVariant = (typeof DIRETTA_CPU_VARIANTS)[number];

/**
 * 解析 Diretta x86-64 CPU variant。
 * @param value - 命令行或环境变量中的 variant
 * @returns 受支持的 variant
 */
export const parseDirettaCpuVariant = (value: string): DirettaCpuVariant => {
  if ((DIRETTA_CPU_VARIANTS as readonly string[]).includes(value)) {
    return value as DirettaCpuVariant;
  }
  throw new Error(
    `不支持的 Diretta CPU variant: ${value}，可选值为 ${DIRETTA_CPU_VARIANTS.join(", ")}`,
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
