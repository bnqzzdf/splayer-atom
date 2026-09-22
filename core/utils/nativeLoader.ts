import { createRequire } from "module";
import path from "path";
import { runtimeEnvironment } from "@main/atom/runtime/environment";
import { nativeLog } from "./logger";

const requireNative = createRequire(import.meta.url);

/**
 * 加载一个原生插件
 * @param fileName 编译后的文件名 (例如: "audio-engine.node")
 * @param devDirName 开发环境下的目录名 (例如: "audio-engine")，必须位于项目根目录的 native/ 下
 */
export const loadNativeModule = <T = unknown>(fileName: string, devDirName: string): T | null => {
  let nativeModulePath: string;

  if (runtimeEnvironment.nativeDir) {
    nativeModulePath = path.join(runtimeEnvironment.nativeDir, fileName);
  } else if (runtimeEnvironment.isPackaged) {
    // Core artifact: resources/native/audio-engine.node
    nativeModulePath = path.join(runtimeEnvironment.resourcesDir, "native", fileName);
  } else {
    // 开发时: native/audio-engine/audio-engine.node
    nativeModulePath = path.join(process.cwd(), "native", devDirName, fileName);
  }

  try {
    const mod = requireNative(nativeModulePath) as T;
    nativeLog.debug(`加载 ${fileName} 成功`);
    return mod;
  } catch (error) {
    nativeLog.error(`加载 ${fileName} 失败:`, error);
    return null;
  }
};
