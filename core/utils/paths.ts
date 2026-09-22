import path from "node:path";
import { runtimeEnvironment } from "../atom/runtime/environment";

/**
 * 统一数据根目录
 *
 * 所有应用自定义数据（配置 / 数据库 / 缓存 / 日志 / 插件）集中存放于此，
 * 与 Chromium 自建的 Cache/ GPUCache/ 等隔开，便于备份与后续便携版整体迁移。
 * 仅需改这一处即可整体改变数据落点（如便携版指向 exe 同级目录）。
 */
export const dataRoot =
  runtimeEnvironment.dataDir ?? path.join(runtimeEnvironment.userDataDir, "app-data");

/** Core 配置目录。 */
export const configDir = path.join(dataRoot, "config");

/** 数据库目录：library.db */
export const databaseDir = path.join(dataRoot, "database");

/** 默认缓存根目录：covers / artists / backgrounds / songs */
export const defaultCacheDir = runtimeEnvironment.cacheDir ?? path.join(dataRoot, "cache");

/** 日志根目录：应用日志 + native/ */
export const logsDir = path.join(dataRoot, "logs");

/** 插件根目录：scripts / data / logs */
export const pluginsDir = path.join(dataRoot, "plugins");
