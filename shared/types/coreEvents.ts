import type { ProviderSessionsSnapshot } from "./apis";
import type { DownloadProgress, DownloadTask } from "./download";
import type { ScanProgress } from "./library";

/** Core Domain 向 Control 投影的低频业务事件。 */
export type CoreControlEvent =
  | { type: "providerSessions"; data: ProviderSessionsSnapshot }
  | { type: "libraryScanProgress"; data: ScanProgress }
  | { type: "downloadState"; data: DownloadTask }
  | { type: "downloadProgress"; data: DownloadProgress };

/** Desktop preload 只负责承载统一 Core event envelope。 */
export interface CoreEventsApi {
  onEvent: (callback: (event: CoreControlEvent) => void) => () => void;
}
