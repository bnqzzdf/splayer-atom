import type { ProviderSessionsSnapshot } from "./apis";
import type { DownloadProgress, DownloadTask } from "./download";
import type { ScanProgress } from "./library";
import type { PlayerEvent } from "./player";
import type { NowPlayingLyricOffsetSync } from "./nowPlaying";
import type { PluginInfo } from "./plugin";

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
  | { type: "downloadState"; data: DownloadTask }
  | { type: "downloadProgress"; data: DownloadProgress }
  | { type: "streamingLibraryUpdated"; data: { serverId: string } }
  | { type: "lyricOffset"; data: NowPlayingLyricOffsetSync }
  | { type: "pluginStatus"; data: PluginInfo }
  | CorePlayerProjectionEvent;
