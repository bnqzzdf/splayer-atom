import { store } from "@main/store";

/** 兼容旧 IPC；真实 policy authority 位于 Core settings。 */
export const setPauseOnDeviceSwitch = (enabled: boolean): void => {
  store.set("player.pauseOnDeviceSwitch", enabled);
};
