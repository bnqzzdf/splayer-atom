import type { ProviderSessionsSnapshot } from "./apis";
import type { DownloadProgress, DownloadTask } from "./download";
import type { ScanProgress } from "./library";
import type { PlayerEvent } from "./player";
import type { NowPlayingLyricOffsetSync } from "./nowPlaying";

/** 已确认不携带 Host command/recovery 语义的 Player projection。 */
export type CorePlayerProjectionEvent = Extract<
  PlayerEvent,
  {
    type: "status" | "trackLoaded" | "position" | "fftData" | "error" | "deviceChanged" | "session";
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
  | CorePlayerProjectionEvent;

/** Desktop preload 只负责承载统一 Core event envelope。 */
export interface CoreEventsApi {
  onEvent: (callback: (event: CoreControlEvent) => void) => () => void;
}
