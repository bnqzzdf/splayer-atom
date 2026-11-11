import path from "node:path";
import { runtimeEnvironment } from "../atom/runtime/environment";

/** 统一数据根目录（配置 / 数据库 / 缓存 / 插件） */
export const dataRoot =
  runtimeEnvironment.dataDir ?? path.join(runtimeEnvironment.userDataDir, "app-data");

/** Core 配置目录。 */
export const configDir = path.join(dataRoot, "config");

/** 数据库目录：library.db */
export const databaseDir = path.join(dataRoot, "database");

/** 默认缓存根目录：covers / artists / backgrounds / songs */
export const defaultCacheDir = runtimeEnvironment.cacheDir ?? path.join(dataRoot, "cache");

/** 插件根目录：scripts / data */
export const pluginsDir = path.join(dataRoot, "plugins");
