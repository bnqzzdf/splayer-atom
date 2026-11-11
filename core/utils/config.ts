import path from "node:path";
import { store } from "@main/store";
import { runtimeEnvironment } from "@main/atom/runtime/environment";
import { defaultCacheDir } from "./paths";

/** 是否为 Windows 系统 */
export const isWin = process.platform === "win32";

/** 当前生效的缓存根目录 */
export const getAppCacheDir = (): string => store.get("cache.dir") || defaultCacheDir;

/** 当前生效的封面缩略图目录 */
export const getCoverCacheDir = (): string => path.join(getAppCacheDir(), "covers");

/** 当前生效的歌手头像目录 */
export const getArtistCacheDir = (): string => path.join(getAppCacheDir(), "artists");

/** 当前生效的背景图目录 */
export const getBackgroundsDir = (): string => path.join(getAppCacheDir(), "backgrounds");

/** 当前生效的歌曲缓存目录 */
export const getSongCacheDir = (): string => path.join(getAppCacheDir(), "songs");

/** 当前生效的下载目录（默认：系统音乐目录下的软件名子目录） */
export const getDownloadDir = (): string =>
  store.get("download.dir") || path.join(runtimeEnvironment.musicDir, runtimeEnvironment.appName);
