import type { CoreControlEvent } from "@shared/types/coreEvents";
import { publishDesktopEvent } from "@main/atom/runtime/events";
import { wsBroadcast } from "@main/server/broadcast";

/**
 * 将一条 Core Domain 事件同时投影到 Desktop 与 Web Control。
 * 两端消费完全相同的 event envelope；物理 transport 分别为 Electron IPC 与现有 WS。
 */
export const publishCoreControlEvent = (event: CoreControlEvent): void => {
  publishDesktopEvent("core:event", event);
  wsBroadcast(event);
};
