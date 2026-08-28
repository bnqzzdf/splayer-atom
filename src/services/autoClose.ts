/**
 * 定时关闭 Control 投影。
 *
 * Core 持有 deadline 与最终 pause/ended 决策；renderer 只刷新倒计时并发送高层 command。
 */

import type { PlaybackAutoCloseSnapshot } from "@shared/types/player";
import { useStatusStore } from "@/stores/status";

let tickHandle: ReturnType<typeof setInterval> | null = null;

const stopTick = (): void => {
  if (tickHandle !== null) clearInterval(tickHandle);
  tickHandle = null;
};

const tick = (): void => {
  const autoClose = useStatusStore().autoClose;
  if (!autoClose.enable) {
    stopTick();
    return;
  }
  autoClose.remainTime = Math.max(0, Math.ceil((autoClose.endTime - Date.now()) / 1000));
  if (autoClose.remainTime <= 0) stopTick();
};

const startTick = (): void => {
  stopTick();
  tick();
  if (useStatusStore().autoClose.enable && useStatusStore().autoClose.remainTime > 0) {
    tickHandle = setInterval(tick, 1000);
  }
};

/** 应用 Core session 中的 authoritative auto-close runtime snapshot。 */
export const applySnapshot = (snapshot?: PlaybackAutoCloseSnapshot): void => {
  const autoClose = useStatusStore().autoClose;
  if (!snapshot) {
    autoClose.enable = false;
    autoClose.endTime = 0;
    autoClose.remainTime = 0;
    autoClose.waitSongEnd = false;
    autoClose.pendingStopOnEnd = false;
    stopTick();
    return;
  }
  autoClose.enable = snapshot.enabled;
  autoClose.duration = snapshot.duration;
  autoClose.endTime = snapshot.endTime;
  autoClose.waitSongEnd = snapshot.waitSongEnd;
  autoClose.pendingStopOnEnd = snapshot.pendingStopOnEnd;
  autoClose.remainTime = snapshot.enabled
    ? Math.max(0, Math.ceil((snapshot.endTime - Date.now()) / 1000))
    : 0;
  if (snapshot.enabled) startTick();
  else stopTick();
};

/** 启动或更新 Core 定时关闭。 */
export const start = (durationMin: number, waitSongEnd: boolean): void => {
  const duration = Math.max(1, Math.round(durationMin));
  void window.api.player.setSessionAutoClose(duration, waitSongEnd).then((result) => {
    if (result.success && result.data) applySnapshot(result.data.autoClose);
  });
};

/** 取消 Core 定时关闭。 */
export const cancel = (): void => {
  void window.api.player.cancelSessionAutoClose().then((result) => {
    if (result.success && result.data) applySnapshot(result.data.autoClose);
  });
};

/**
 * Desktop 事件 ownership 迁移期间的 fallback：只有 Core 已标记 pending 时才阻止 renderer auto-next。
 * Core 全面消费 ended 后该分支不会被调用。
 */
export const onTrackEnded = (): boolean => {
  if (!useStatusStore().autoClose.pendingStopOnEnd) return false;
  void window.api.player.pause().catch(() => {});
  cancel();
  return true;
};
