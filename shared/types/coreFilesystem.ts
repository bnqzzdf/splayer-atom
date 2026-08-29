/** Core 文件系统目录浏览结果；路径始终属于 Core 主机。 */
export interface CoreDirectoryEntry {
  name: string;
  path: string;
}

export interface CoreDirectoryListing {
  path: string;
  parent: string | null;
  directories: CoreDirectoryEntry[];
}
