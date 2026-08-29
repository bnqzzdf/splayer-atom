import { dialog, ipcMain } from "electron";
import {
  fetchLyricTTMLOverlay,
  matchCoreLocalTTML,
  matchLyricById,
  matchLyricByQuery,
} from "@main/services/lyricMatching";
import type { LyricTTMLResponse } from "@shared/types/lyrics";
import type { Platform } from "@shared/types/platform";
import type { Track } from "@shared/types/player";

/** 注册歌词匹配与 Desktop Host picker IPC。 */
export const registerLyricsIpc = (): void => {
  ipcMain.handle("lyrics:matchById", (_event, platform: Platform, id: string) =>
    matchLyricById(platform, id),
  );
  ipcMain.handle("lyrics:matchByQuery", (_event, platform: Platform, track: Track) =>
    matchLyricByQuery(platform, track),
  );
  ipcMain.handle(
    "lyrics:fetchTTMLOverlay",
    (_event, track: Track, platform: "netease" | "qqmusic") =>
      fetchLyricTTMLOverlay(track, platform),
  );
  ipcMain.handle("lyrics:matchLocalTTML", (_event, track: Track): Promise<LyricTTMLResponse> =>
    matchCoreLocalTTML(track),
  );
  ipcMain.handle("lyrics:pickLyricRepoDir", async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: "选择本地 TTML 歌词库目录",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
};
