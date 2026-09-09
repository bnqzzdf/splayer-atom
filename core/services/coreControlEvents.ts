import type { CoreControlEvent } from "@shared/types/coreEvents";
import { wsBroadcast } from "@main/server/broadcast";

/** 将一条 Core Domain 事件投影到 Web Control。 */
export const publishCoreControlEvent = (event: CoreControlEvent): void => {
  wsBroadcast(event);
};
