import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { runtimeEnvironment } from "../atom/runtime/environment";
import type { CoreDirectoryListing } from "@shared/types/coreFilesystem";

/**
 * 规范化并验证一个属于 Core 主机的目录路径。
 * @param input - Core 主机目录路径
 * @returns 实际目录路径
 */
export const resolveCoreDirectory = async (input: string): Promise<string> => {
  const candidate = input.trim();
  if (!candidate) throw new Error("CORE_DIRECTORY_REQUIRED");
  const resolved = path.resolve(candidate);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) throw new Error("CORE_DIRECTORY_NOT_FOUND");
  return fs.realpath(resolved);
};

/** Core directory browser 的默认起点。 */
const defaultDirectory = async (): Promise<string> => {
  for (const candidate of [
    runtimeEnvironment.musicDir,
    os.homedir(),
    path.parse(process.cwd()).root,
  ]) {
    try {
      return await resolveCoreDirectory(candidate);
    } catch {
      // 继续尝试更保守的现有目录。
    }
  }
  return path.parse(process.cwd()).root;
};

/**
 * 列出 Core 主机上的直接子目录，不暴露文件内容。
 * @param input - 起始目录；缺省时从 Core 音乐目录开始
 */
export const listCoreDirectories = async (input?: string): Promise<CoreDirectoryListing> => {
  const current = input?.trim() ? await resolveCoreDirectory(input) : await defaultDirectory();
  const entries = await fs.readdir(current, { withFileTypes: true });
  const directories = (
    await Promise.all(
      entries.map(async (entry) => {
        const child = path.join(current, entry.name);
        if (entry.isDirectory()) return { name: entry.name, path: child };
        if (!entry.isSymbolicLink()) return null;
        try {
          const stat = await fs.stat(child);
          return stat.isDirectory() ? { name: entry.name, path: await fs.realpath(child) } : null;
        } catch {
          return null;
        }
      }),
    )
  )
    .filter((entry): entry is { name: string; path: string } => entry !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
  const parent = path.dirname(current);
  return {
    path: current,
    parent: parent === current ? null : parent,
    directories,
  };
};
