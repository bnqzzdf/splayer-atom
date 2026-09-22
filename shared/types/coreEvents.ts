import type { ProviderSessionsSnapshot } from "./apis";
import type { DownloadProgress, DownloadTask } from "./download";
import type { ScanProgress } from "./library";
import type { PlayerEvent } from "./player";
import type { NowPlayingLyricOffsetSync } from "./nowPlaying";
import type { PluginInfo } from "./plugin";
import type { StreamingConfigSnapshot } from "./streaming";

/** 已确认不携带 Host command/recovery 语义的 Player projection。 */
export type CorePlayerProjectionEvent = Extract<
  PlayerEvent,
  {
    type: "status" | "trackLoaded" | "position" | "error" | "deviceChanged" | "session";
  }
>;

/** Core Domain 向 Control 投影的业务事件。 */
export type CoreControlEvent =
  | { type: "providerSessions"; data: ProviderSessionsSnapshot }
  | { type: "libraryScanProgress"; data: ScanProgress }
  | { type: "libraryChanged"; data: { revision: number } }
  | { type: "libraryLikesChanged"; data: { ids: string[] } }
  | { type: "libraryRootsChanged"; data: { paths: string[] } }
  | { type: "folderPinsChanged"; data: { paths: string[] } }
  | { type: "downloadState"; data: DownloadTask }
  | { type: "downloadProgress"; data: DownloadProgress }
  | { type: "streamingConfigUpdated"; data: StreamingConfigSnapshot }
  | { type: "streamingLibraryUpdated"; data: { serverId: string } }
  | { type: "lyricOffset"; data: NowPlayingLyricOffsetSync }
  | { type: "pluginStatus"; data: PluginInfo }
  | CorePlayerProjectionEvent;
