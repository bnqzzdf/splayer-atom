import path from "node:path";
import { getAppCacheDir } from "@main/utils/config";

/** 将缓存目录内的磁盘路径转换为 Control 可识别的 cache:// URL。 */
export const toCacheUrl = (filePath: string | undefined | null): string | undefined => {
  if (!filePath) return undefined;
  const relative = path.relative(getAppCacheDir(), filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return `cache://${relative.replace(/\\/g, "/")}`;
};
