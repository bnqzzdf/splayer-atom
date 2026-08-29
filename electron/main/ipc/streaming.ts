import { ipcMain } from "electron";
import { registerStreamingCoverProtocol } from "@main/services/streaming/coverProtocol";
import { withStreamingAdapter } from "@main/services/streaming/connection";

/** 注册 Desktop Streaming Host/legacy compatibility IPC。 */
export const registerStreamingIpc = (): void => {
  registerStreamingCoverProtocol();

  // legacy renderer compatibility；正式播放源解析由 Core PlaybackSourceResolver 持有。
  ipcMain.handle(
    "streaming:getStreamUrl",
    (_event, serverId: string, trackId: string, playSessionId?: string) =>
      withStreamingAdapter(serverId, (config, adapter) =>
        adapter.getStreamUrl(config, trackId, playSessionId),
      ),
  );
};
