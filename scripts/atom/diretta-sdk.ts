import { readFileSync } from "node:fs";
import path from "node:path";

export const DIRETTA_SDK_RELEASE = 149;

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
