export const CORE_NODE_REFERENCE = "24.18.0";
export const CORE_NODE_RANGE = ">=22.19.0";

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

/** Core 当前正式支持的最低 Node 版本。 */
export const isSupportedCoreNodeRuntime = (version: string): boolean => {
  const parsed = parseNodeVersion(version);
  if (!parsed) return false;
  if (parsed.major > 22) return true;
  if (parsed.major < 22) return false;
  if (parsed.minor > 19) return true;
  if (parsed.minor < 19) return false;
  return parsed.patch >= 0;
};

/**
 * 在任何 Core database/native/plugin 模块加载前验证实际 Node runtime。
 * 支持范围与 reference runtime 分离：运行最低要求 Node 22.19，release 门禁固定 24.18.0。
 */
export const assertSupportedCoreNodeRuntime = (version = process.versions.node): void => {
  if (isSupportedCoreNodeRuntime(version)) return;
  throw new Error(
    `Unsupported Node runtime ${version}; SPlayer Atom Core requires ${CORE_NODE_RANGE}`,
  );
};
