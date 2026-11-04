import path from "node:path";
import { resolveCoreDirectory } from "@main/services/coreFilesystem";

/** 已注册的离线根目录不能因为暂时不可访问而被强制移除。 */
export const normalizeScanRoot = async (dir: string): Promise<string> => {
  try {
    return await resolveCoreDirectory(dir);
  } catch {
    return path.resolve(dir);
  }
};

const contains = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};

/** 比较规范化后的 Linux 扫描根目录，包括自身、父子目录及 / 根目录。 */
export const scanRootsOverlap = (a: string, b: string): boolean => contains(a, b) || contains(b, a);

export const hasNestedScanRoots = (dirs: string[]): boolean =>
  dirs.some((root, index) => dirs.slice(0, index).some((other) => scanRootsOverlap(root, other)));
