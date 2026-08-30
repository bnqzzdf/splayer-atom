import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CORE_PROTOCOL_VERSION } from "../../../../shared/constants/coreProtocol";
import type { CoreCapabilities, CoreInfo } from "@shared/types/core";
import { runtimeEnvironment } from "./environment";
import { CORE_NODE_RANGE, CORE_NODE_REFERENCE } from "./nodeRuntime";

interface NativeBuildMetadata {
  diretta?: boolean;
}

interface RuntimeReleaseMetadata {
  atomVersion?: string;
  atomCommit?: string;
  sourceDirty?: boolean;
  splayerBaseline?: string;
}

const envText = (name: string): string | null => {
  const value = process.env[name]?.trim();
  return value ? value : null;
};

/** packaged Core 从 runtime.json 读取可追溯 release identity；开发态可由环境变量覆盖。 */
const readRuntimeReleaseMetadata = (): RuntimeReleaseMetadata => {
  const file = path.join(runtimeEnvironment.resourcesDir, "runtime.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as RuntimeReleaseMetadata;
  } catch {
    return {};
  }
};

/** 读取当前 Core native flavor 的构建能力；缺失/损坏 metadata 时按最小能力处理。 */
const readNativeBuildMetadata = (): NativeBuildMetadata => {
  const nativeDir = runtimeEnvironment.nativeDir;
  if (!nativeDir) return {};
  const file = path.join(nativeDir, "build.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as NativeBuildMetadata;
  } catch {
    return {};
  }
};

/** 返回当前 Core 实际可用的 domain capability，不包含登录态。 */
export const getCoreCapabilities = (): CoreCapabilities => {
  const nativeBuild = readNativeBuildMetadata();
  return {
    library: true,
    playback: true,
    download: true,
    diretta: nativeBuild.diretta === true,
    netease: true,
    qobuz: true,
    tidal: true,
    remoteOutput: false,
  };
};

/** 返回 Control 建立兼容连接所需的 Core 元信息。 */
export const getCoreInfo = (): CoreInfo => {
  const release = readRuntimeReleaseMetadata();
  return {
    name: runtimeEnvironment.appName,
    version: envText("ATOM_APP_VERSION") ?? release.atomVersion ?? runtimeEnvironment.appVersion,
    commit: envText("ATOM_COMMIT") ?? release.atomCommit ?? "unknown",
    sourceDirty:
      envText("ATOM_SOURCE_DIRTY") !== null
        ? envText("ATOM_SOURCE_DIRTY") === "1"
        : release.sourceDirty === true,
    splayerBaseline: envText("ATOM_SPLAYER_BASELINE") ?? release.splayerBaseline ?? "unknown",
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    nodeRange: CORE_NODE_RANGE,
    nodeReference: CORE_NODE_REFERENCE,
    protocol: { version: CORE_PROTOCOL_VERSION },
    capabilities: getCoreCapabilities(),
  };
};
