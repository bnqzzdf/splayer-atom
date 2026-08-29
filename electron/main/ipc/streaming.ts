import { registerStreamingCoverProtocol } from "@main/services/streaming/coverProtocol";

/** 注册 Desktop Streaming 封面 Host protocol。 */
export const registerStreamingIpc = (): void => {
  registerStreamingCoverProtocol();
};
