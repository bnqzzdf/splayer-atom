import path from "node:path";

/** 将合法的 cache:// URL 还原为指定缓存根目录内的磁盘路径。 */
export const resolveCacheUrl = (
  url: string | undefined | null,
  root: string,
): string | undefined => {
  if (!url?.startsWith("cache://")) return undefined;
  let relative: string;
  try {
    relative = decodeURIComponent(url.slice("cache://".length).split("?")[0]);
  } catch {
    return undefined;
  }
  const resolved = path.resolve(root, relative);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved === root || !resolved.startsWith(rootWithSep)) return undefined;
  return resolved;
};
