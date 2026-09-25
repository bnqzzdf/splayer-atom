import { readFileSync } from "node:fs";
import path from "node:path";

export const DIRETTA_SDK_RELEASE = 150;
/**
 * Diretta SDK 为 x86-64 提供的预编译库变体。
 *
 * 变体不是「优化等级」，而是**能不能在这台机器上跑**：SDK 的预编译静态库按
 * `-march=x86-64-vN` 分别发布，v3 库里带 AVX/AVX2 指令，在只到 v2 的 CPU
 * （如 Intel Celeron J1900，Silvermont，完全没有 AVX）上执行会直接 SIGILL。
 * 因此产物必须按目标 CPU 代次选变体编译，并把变体写进产物文件名。
 *
 * 实测（Diretta SDK 150，`objdump -d` 统计 AVX 类指令）：
 * - `libACQUA_x64-linux-15v2-nolog.a`     0 条
 * - `libDirettaHost_x64-linux-15v2-nolog.a` 0 条
 * - `libACQUA_x64-linux-15v3-nolog.a`     623 条
 * - `libDirettaHost_x64-linux-15v3-nolog.a` 466 条
 *
 * **没有 v1**：SDK 150 只发布 v2/v3/v4/zen4，所以「带 Diretta 的 v1 产物」
 * 不存在；需要 v1 只能做不带 Diretta 的 ALSA-only 构建。
 */
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
