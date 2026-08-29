import type { CoreInfo } from "@shared/types/core";

/** 首个正式 Core Protocol major。 */
export const CORE_PROTOCOL_VERSION = 1;

/** 当前 Control 可接受的 Core Protocol 范围。 */
export const CONTROL_CORE_PROTOCOL_RANGE = {
  min: 1,
  max: 1,
} as const;

/** 判断当前 Control 是否能安全连接目标 Core。 */
export const isCoreProtocolCompatible = (info: Pick<CoreInfo, "protocol">): boolean => {
  const version = info.protocol.version;
  return (
    Number.isInteger(version) &&
    version >= CONTROL_CORE_PROTOCOL_RANGE.min &&
    version <= CONTROL_CORE_PROTOCOL_RANGE.max
  );
};

/** 不兼容时立即失败，避免 Control 通过产品版本号猜测 API 能力。 */
export const assertCoreProtocolCompatible = (info: Pick<CoreInfo, "protocol">): void => {
  if (isCoreProtocolCompatible(info)) return;
  throw new Error(
    `CORE_PROTOCOL_UNSUPPORTED:${info.protocol.version}:${CONTROL_CORE_PROTOCOL_RANGE.min}-${CONTROL_CORE_PROTOCOL_RANGE.max}`,
  );
};
