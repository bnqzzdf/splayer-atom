/**
 * 下载 IPC
 *
 * Control 构建任务后交给 Core downloadManager 排队；音频源由 Core 在任务执行时即时解析。
 * 本层只保留 Desktop IPC transport 与本机目录选择，不拥有下载状态或解析逻辑。
 */

import { ipcMain, dialog } from "electron";
import { store } from "@main/store";
import { getDownloadDir } from "@main/utils/config";
import * as downloadManager from "@main/services/downloadManager";
import { resolveCoreDirectory } from "@main/services/coreFilesystem";
import type { DownloadRequest } from "@shared/types/download";

export const registerDownloadIpc = (): void => {
  ipcMain.handle("download:start", (_evt, req: DownloadRequest) => downloadManager.enqueue(req));
  ipcMain.handle("download:startMany", (_evt, reqs: DownloadRequest[]) =>
    downloadManager.enqueueMany(reqs),
  );
  ipcMain.handle("download:retry", (_evt, req: DownloadRequest) => downloadManager.enqueue(req));
  ipcMain.handle("download:cancel", (_evt, taskId: string) => downloadManager.cancel(taskId));
  ipcMain.handle("download:remove", (_evt, taskId: string) => downloadManager.remove(taskId));
  ipcMain.handle("download:clearFinished", () => downloadManager.clearFinished());
  ipcMain.handle("download:list", () => downloadManager.list());

  ipcMain.handle("download:getDir", () => getDownloadDir());
  ipcMain.handle("download:setDir", async (_event, requestedDir: string) => {
    const dir = await resolveCoreDirectory(requestedDir);
    store.set("download.dir", dir);
    return dir;
  });
  ipcMain.handle("download:resetDir", () => {
    store.set("download.dir", null);
    return getDownloadDir();
  });
  ipcMain.handle("download:pickDir", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择下载目录",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, dir: getDownloadDir(), reason: "canceled" as const };
    }
    const dir = await resolveCoreDirectory(result.filePaths[0]);
    store.set("download.dir", dir);
    return { ok: true, dir };
  });
};
