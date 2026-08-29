export const CORE_NODE_REFERENCE = "24.18.0";
export const CORE_NODE_RANGE = ">=24.18.0 <25";

interface NodeVersion {
  major: number;
  minor: number;
  patch: number;
}

const parseNodeVersion = (version: string): NodeVersion | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
};

/** Core 当前正式支持的 system Node 24.x 范围。 */
export const isSupportedCoreNodeRuntime = (version: string): boolean => {
  const parsed = parseNodeVersion(version);
  if (!parsed || parsed.major !== 24) return false;
  if (parsed.minor > 18) return true;
  if (parsed.minor < 18) return false;
  return parsed.patch >= 0;
};

/**
 * 在任何 Core database/native/plugin 模块加载前验证实际 Node runtime。
 * 支持范围与 reference runtime 分离：运行允许兼容的 24.x，release 门禁固定 24.18.0。
 */
export const assertSupportedCoreNodeRuntime = (version = process.versions.node): void => {
  if (isSupportedCoreNodeRuntime(version)) return;
  throw new Error(
    `Unsupported Node runtime ${version}; SPlayer Atom Core requires ${CORE_NODE_RANGE}`,
  );
};
