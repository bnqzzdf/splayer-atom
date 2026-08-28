import { extname } from "node:path";
import { app, ipcMain, powerMonitor } from "electron";
import { sendToMain } from "@main/utils/broadcast";
import { readFileAutoEncoding } from "@main/utils/encoding";
import { wsBroadcast } from "@main/server/broadcast";
import { toMs } from "@main/utils/time";
import * as mediaService from "@main/services/media";
import * as nowPlaying from "@main/services/nowPlaying";
import * as lastfm from "@main/services/lastfm";
import * as neteaseScrobble from "@main/services/neteaseScrobble";
import { getPlayer, resetPlayer, onPlayerCreated } from "@main/services/engine";
import * as playbackSession from "@main/services/playbackSession";
import { onHeadlessPlayerEnded, onHeadlessPlayerState } from "@main/services/headlessPlayStats";
import { loadPlayerSource } from "@main/services/playerLoad";
import { toDisplayDurationMs, toDisplayPositionMs } from "@main/services/playerTimeline";
import {
  cancelPendingReinit,
  setPauseOnDeviceSwitch,
  startDeviceMonitoring,
  stopDeviceMonitoring,
  requestReinit,
} from "@main/services/device";
import { getThumbar } from "@main/services/thumbar";
import { setTrayPlayState, setTrayPlayMode, setTrayLikeState } from "@main/services/tray";
import { getMainWindow, setTaskbarProgress } from "@main/window";
import { store } from "@main/store";
import { playerLog } from "@main/utils/logger";
import { cleanupDirectInputs, materializeDirectInput } from "@main/atom/directInput";
import {
  cancelDirectPlaybackNext,
  commitDirectPlaybackBoundary,
  stageDirectPlaybackNext,
} from "@main/services/directGapless";
import { ErrorCode } from "@shared/types/errors";
import type {
  LoadOptions,
  PlaybackQueueItem,
  PlayerState,
  RepeatMode,
  ShuffleMode,
  Track,
} from "@shared/types/player";
import type { MediaEvent } from "@main/services/media";
import type { PersonalFmOptions } from "@shared/types/personalFm";
import { JsPlayerEvent } from "@splayer/audio-engine";

type AudioEngineModule = typeof import("@splayer/audio-engine");

/** 返回失败响应，附带日志 */
const fail = (code: ErrorCode, error?: unknown) => {
  if (error) playerLog.error(`${code}:`, error);
  return { success: false as const, error: code };
};

/** 判断原生错误是否为设备错误 */
const isNativeDeviceError = (error: unknown): boolean => String(error).includes("[Device]");
/**
 * 播放器原生事件回调
 * @param inst 播放器实例
 */
const registerNativeEvents = (inst: InstanceType<AudioEngineModule["AudioPlayer"]>): void => {
  inst.onEvent((event: JsPlayerEvent) => {
    switch (event.type) {
      case "stateChanged": {
        const state = (event.state ?? "idle") as PlayerState;
        onHeadlessPlayerState(state);
        // 更新缩略图工具栏和托盘菜单
        getThumbar()?.updateThumbar(state === "playing");
        setTrayPlayState(state === "playing" ? "playing" : "paused");
        if (state === "playing") {
          mediaService.setPlayState({ status: "Playing" });
        } else if (state === "paused") {
          mediaService.setPlayState({ status: "Paused" });
          if (store.get("system.taskbarProgress")) {
            const dur = toDisplayDurationMs(toMs(inst.getDuration()));
            const pos = toDisplayPositionMs(toMs(inst.getPosition()));
            if (dur > 0) setTaskbarProgress(pos / dur, true);
          }
        } else if (state === "stopped") {
          mediaService.setPlayState({ status: "Paused" });
          setTaskbarProgress(-1);
        }
        nowPlaying.onPlayStateChange(state);
        lastfm.onState(state === "playing");
        neteaseScrobble.onState(state === "playing");
        const statusEvent = {
          type: "status",
          data: {
            state,
            position: toDisplayPositionMs(toMs(inst.getPosition())),
            duration: toDisplayDurationMs(toMs(inst.getDuration())),
            volume: inst.getVolume(),
            speed: inst.getSpeed(),
            isFinished: false,
          },
        };
        sendToMain("player:event", statusEvent);
        wsBroadcast(statusEvent);
        break;
      }
      case "ended": {
        onHeadlessPlayerEnded();
        const consumedBySession = playbackSession.onNativeEnded();
        if (!consumedBySession) sendToMain("player:event", { type: "ended" });
        wsBroadcast({ type: "ended", data: { consumedBySession } });
        mediaService.setPlayState({ status: "Paused" });
        lastfm.onEnded();
        neteaseScrobble.onEnded();
        setTaskbarProgress(-1);
        break;
      }
      case "directTrackBoundary": {
        const duration = toMs(event.duration ?? 0);
        const generation = event.generation ?? 0;
        // 先结算上一首，再由 Core 提交已跨过的 staged 下一首。
        lastfm.onEnded();
        neteaseScrobble.onEnded();
        const consumedBySession = playbackSession.onNativeDirectTrackBoundary(generation, duration);
        if (!consumedBySession) {
          sendToMain("player:event", {
            type: "directTrackBoundary",
            data: { duration, generation },
          });
        }
        wsBroadcast({
          type: "directTrackBoundary",
          data: { duration, generation, consumedBySession },
        });
        mediaService.setTimeline({ currentMs: 0, totalMs: duration });
        break;
      }
      case "sourceError": {
        // 音源失效（网络中断 / URL 过期）
        const consumedBySession = playbackSession.onNativeSourceError();
        if (!consumedBySession) sendToMain("player:event", { type: "sourceError" });
        mediaService.setPlayState({ status: "Paused" });
        neteaseScrobble.onState(false);
        setTaskbarProgress(-1);
        break;
      }
      case "position": {
        const posMs = toDisplayPositionMs(toMs(event.position ?? 0));
        const durMs = toDisplayDurationMs(toMs(event.duration ?? 0));
        const positionEvent = {
          type: "position",
          data: { position: posMs, duration: durMs },
        };
        // 主窗口隐藏时跳过高频推送
        if (getMainWindow()?.isVisible()) sendToMain("player:event", positionEvent);
        wsBroadcast(positionEvent);
        mediaService.setTimeline({ currentMs: posMs, totalMs: durMs });
        nowPlaying.onPosition(posMs, true);
        lastfm.onPosition();
        neteaseScrobble.onPosition(posMs);
        if (store.get("system.taskbarProgress") && durMs > 0) setTaskbarProgress(posMs / durMs);
        break;
      }
      case "fftData": {
        const fftEvent = { type: "fftData", data: event.fftData ?? { ldata: [], rdata: [] } };
        if (getMainWindow()?.isVisible()) sendToMain("player:event", fftEvent);
        wsBroadcast(fftEvent);
        break;
      }
      case "outputFailed": {
        // 运行期流错误（CPAL/Rodio），重建输出流恢复播放
        playerLog.warn("检测到音频输出流错误，触发恢复");
        requestReinit(inst);
        break;
      }
      case "outputStalled": {
        // 看门狗：无流错误但长期未消费样本
        playerLog.warn("检测到音频输出停滞，触发恢复");
        requestReinit(inst);
        break;
      }
    }
  });
};

/** 播放器相关 IPC */
export const registerPlayerIpc = (): void => {
  // 注册实例创建/重建时的回调
  onPlayerCreated(registerNativeEvents);
  onPlayerCreated(startDeviceMonitoring);
  // 加载音频文件
  ipcMain.handle("player:load", async (_event, source: string, options: LoadOptions = {}) => {
    return loadPlayerSource(source, options);
  });

  // 恢复播放；实际 load/reload 决策由 Core PlaybackSession 持有。
  ipcMain.handle("player:play", async () => {
    try {
      await playbackSession.play();
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.DEVICE_NOT_FOUND, error);
    }
  });

  // 暂停播放
  ipcMain.handle("player:pause", () => {
    try {
      playbackSession.pause();
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 停止播放并释放资源
  ipcMain.handle("player:stop", () => {
    try {
      cancelPendingReinit();
      playbackSession.stop();
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 跳转到指定播放位置
  ipcMain.handle("player:seek", async (_event, positionMs: number) => {
    try {
      await playbackSession.seek(positionMs);
      mediaService.setTimeline({
        currentMs: positionMs,
        totalMs: toDisplayDurationMs(toMs(getPlayer().getDuration())),
        seeked: true,
      });
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  ipcMain.handle("player:getSession", () => ({
    success: true,
    data: playbackSession.getPlaybackSession(),
  }));

  ipcMain.handle("player:reloadSessionCurrent", async (_event, forcePlay?: boolean) => ({
    success: true,
    data: await playbackSession.reloadCurrent(forcePlay),
  }));

  ipcMain.handle(
    "player:migrateLegacySessionQueue",
    (
      _event,
      items: PlaybackQueueItem[],
      originalItems: PlaybackQueueItem[] | null,
      legacyIndex: number,
      legacyRepeat: RepeatMode,
      legacyShuffle: ShuffleMode,
    ) => ({
      success: true,
      data: playbackSession.migrateLegacyQueue(
        items,
        originalItems,
        legacyIndex,
        legacyRepeat,
        legacyShuffle,
      ),
    }),
  );

  ipcMain.handle(
    "player:replaceSessionQueue",
    async (
      _event,
      items: PlaybackQueueItem[],
      startIndex = 0,
      autoPlay = true,
      loadCurrent = true,
    ) => ({
      success: true,
      data: await playbackSession.replaceQueue(items, startIndex, autoPlay, loadCurrent),
    }),
  );

  ipcMain.handle("player:appendSessionQueue", (_event, items: PlaybackQueueItem[]) => ({
    success: true,
    data: playbackSession.appendQueue(items),
  }));

  ipcMain.handle(
    "player:insertSessionQueue",
    (_event, items: PlaybackQueueItem[], insertIndex: number) => ({
      success: true,
      data: playbackSession.insertQueue(items, insertIndex),
    }),
  );

  ipcMain.handle(
    "player:removeSessionQueueIndex",
    async (_event, removeIndex: number, loadCurrent = true) => ({
      success: true,
      data: await playbackSession.removeQueueIndex(removeIndex, loadCurrent),
    }),
  );

  ipcMain.handle(
    "player:selectSessionIndex",
    async (_event, targetIndex: number, loadCurrent = true, autoPlay = true) => ({
      success: true,
      data: await playbackSession.selectIndex(targetIndex, loadCurrent, autoPlay),
    }),
  );

  ipcMain.handle("player:nextSession", async (_event, loadCurrent = true) => {
    await playbackSession.next(loadCurrent);
    return { success: true, data: playbackSession.getPlaybackSession() };
  });

  ipcMain.handle("player:prevSession", async (_event, loadCurrent = true) => {
    await playbackSession.prev(loadCurrent);
    return { success: true, data: playbackSession.getPlaybackSession() };
  });

  ipcMain.handle(
    "player:updateSessionQueueItem",
    (_event, itemIndex: number, item: PlaybackQueueItem) => ({
      success: true,
      data: playbackSession.updateQueueItem(itemIndex, item),
    }),
  );

  ipcMain.handle("player:moveSessionQueue", (_event, fromIndex: number, toIndex: number) => ({
    success: true,
    data: playbackSession.moveQueue(fromIndex, toIndex),
  }));

  ipcMain.handle("player:removeSessionServerTracks", (_event, serverId: string) => ({
    success: true,
    data: playbackSession.removeServerTracks(serverId),
  }));

  ipcMain.handle("player:updateSessionQueueTracks", (_event, tracks: Track[]) => ({
    success: true,
    data: playbackSession.updateQueueTracks(tracks),
  }));

  ipcMain.handle("player:clearSessionQueue", async (_event, stop = false) => {
    await playbackSession.clearQueue(stop);
    return { success: true, data: playbackSession.getPlaybackSession() };
  });

  ipcMain.handle("player:setSessionRepeat", (_event, mode: RepeatMode) => ({
    success: true,
    data: playbackSession.setRepeat(mode),
  }));

  ipcMain.handle("player:setSessionShuffle", (_event, mode: ShuffleMode) => ({
    success: true,
    data: playbackSession.setShuffle(mode),
  }));

  ipcMain.handle(
    "player:startPersonalFm",
    async (_event, options?: PersonalFmOptions, autoPlay = true) => ({
      success: true,
      data: await playbackSession.startPersonalFm(options, autoPlay),
    }),
  );

  ipcMain.handle("player:dislikePersonalFm", async (_event, playedSec?: number) => ({
    success: true,
    data: await playbackSession.dislikePersonalFm(playedSec),
  }));

  ipcMain.handle(
    "player:setSessionAutoClose",
    (_event, durationMin: number, waitSongEnd: boolean) => ({
      success: true,
      data: playbackSession.setAutoClose(durationMin, waitSongEnd),
    }),
  );

  ipcMain.handle("player:cancelSessionAutoClose", () => ({
    success: true,
    data: playbackSession.cancelAutoClose(),
  }));

  // 为 Diretta Source Direct 预备同 wire-format 的下一本地音源。
  // staging 不兼容是正常降级条件：保持当前播放，renderer 在边界走普通 load。
  ipcMain.handle(
    "player:stageDirectNext",
    async (_event, source: string, durationMs: number, generation: number) => ({
      success: true,
      data: await stageDirectPlaybackNext(source, durationMs, generation),
    }),
  );

  ipcMain.handle("player:cancelDirectNext", () => {
    try {
      cancelDirectPlaybackNext();
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  ipcMain.handle(
    "player:commitDirectGaplessBoundary",
    async (
      _event,
      source: string,
      durationMs: number,
      authoritative?: LoadOptions["meta"],
      context?: LoadOptions["context"],
    ) => {
      try {
        commitDirectPlaybackBoundary(source, durationMs, authoritative, context);
        return { success: true };
      } catch (error) {
        return fail(ErrorCode.UNKNOWN, error);
      }
    },
  );

  // 设置音量（0.0 ~ 1.0）
  ipcMain.handle("player:setVolume", (_event, volume: number) => {
    try {
      getPlayer().setVolume(volume);
      mediaService.setVolume(volume);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  ipcMain.handle("player:setPauseOnDeviceSwitch", (_event, enabled: boolean) => {
    setPauseOnDeviceSwitch(enabled);
    return { success: true };
  });

  // 获取当前音量
  ipcMain.handle("player:getVolume", () => {
    return { success: true, data: getPlayer().getVolume() };
  });

  // 设置暂停/恢复时的渐变时长（毫秒），0 表示禁用
  ipcMain.handle("player:setFadeDuration", (_event, durationMs: number) => {
    try {
      getPlayer().setFadeDuration(durationMs);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 获取当前渐变时长（毫秒）
  ipcMain.handle("player:getFadeDuration", () => {
    return { success: true, data: getPlayer().getFadeDuration() };
  });

  // 获取当前播放状态快照（转毫秒）
  ipcMain.handle("player:getStatus", () => {
    const raw = getPlayer().getStatus();
    return {
      success: true,
      data: {
        state: raw.state,
        position: toDisplayPositionMs(toMs(raw.position)),
        duration: toDisplayDurationMs(toMs(raw.duration)),
        volume: raw.volume,
        speed: getPlayer().getSpeed(),
        isFinished: raw.isFinished,
      },
    };
  });

  // 重建音频输出设备
  ipcMain.handle("player:reinit", async () => {
    try {
      await getPlayer().reinitOutput();
      return { success: true };
    } catch (error) {
      return fail(
        isNativeDeviceError(error) ? ErrorCode.DEVICE_INIT_FAILED : ErrorCode.UNKNOWN,
        error,
      );
    }
  });

  // 启用/禁用音量均衡
  ipcMain.handle("player:setNormalizationEnabled", (_event, enabled: boolean) => {
    try {
      getPlayer().setNormalizationEnabled(enabled);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 启用/禁用均衡器
  ipcMain.handle("player:setEqualizerEnabled", (_event, enabled: boolean) => {
    try {
      getPlayer().setEqualizerEnabled(enabled);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 更新均衡器频段增益（dB 数组，长度 10）
  ipcMain.handle("player:setEqualizerBands", (_event, gainsDb: number[]) => {
    try {
      getPlayer().setEqualizerBands(gainsDb);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 设置前级增益（dB）
  ipcMain.handle("player:setPreampGain", (_event, preampDb: number) => {
    try {
      getPlayer().setPreampGain(preampDb);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 设置播放速度（0.5 ~ 2.0），引擎侧自动 clamp
  ipcMain.handle("player:setSpeed", (_event, speed: number) => {
    try {
      getPlayer().setSpeed(speed);
      mediaService.setRate(speed);
      nowPlaying.onSpeedChange(speed);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 设置音调偏移（半音 -12 ~ 12），引擎侧自动 clamp
  ipcMain.handle("player:setPitch", (_event, semitones: number) => {
    try {
      getPlayer().setPitch(semitones);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 设置"音调同步"开关（true = 变速保音调）
  ipcMain.handle("player:setPitchSync", (_event, sync: boolean) => {
    try {
      getPlayer().setPitchSync(sync);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 启用/禁用 FFT 频谱推送（前端组件挂载时启用，卸载时禁用）
  ipcMain.handle("player:setFftEnabled", (_event, enabled: boolean) => {
    try {
      getPlayer().setFftEnabled(enabled);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 获取 FFT 频谱数据（128 个频段，值域 0.0 ~ 1.0）
  ipcMain.handle("player:getFftData", () => {
    return { success: true, data: getPlayer().getFftData() };
  });

  // 按需读取外部歌词文件内容
  // 后缀白名单：该通道只服务歌词文件，防止被当成任意文件读取接口
  // 必须与引擎扫描列表一致（native/audio-engine/src/metadata.rs 的 LYRIC_EXTENSIONS）
  const LYRIC_FILE_EXTS = new Set([
    ".ttml",
    ".lys",
    ".qrc",
    ".krc",
    ".yrc",
    ".lrc",
    ".ass",
    ".srt",
  ]);
  ipcMain.handle("player:readLyricFile", async (_event, filePath: string) => {
    try {
      const ext = extname(filePath).toLowerCase();
      if (!LYRIC_FILE_EXTS.has(ext)) {
        return fail(ErrorCode.UNKNOWN, new Error(`不支持的歌词文件类型: ${ext}`));
      }
      const content = await readFileAutoEncoding(filePath);
      return { success: true, data: content };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 获取当前歌曲的原始高清封面（base64 data URL）
  // 用于全屏播放器等需要高清封面的场景，按需调用，不缓存
  ipcMain.handle("player:getCoverRaw", () => {
    try {
      const inst = getPlayer();
      const raw = inst.getCoverRaw();
      if (!raw) return { success: true, data: null };
      // 转为 base64 data URL，用完即丢，不持有引用
      const base64 = Buffer.from(raw).toString("base64");
      return { success: true, data: `data:image/jpeg;base64,${base64}` };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 获取所有音频输出设备
  ipcMain.handle("player:getOutputDevices", () => {
    try {
      return { success: true, data: getPlayer().getOutputDevices() };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 异步扫描 Diretta Target
  ipcMain.handle("player:scanDirettaDevices", async () => {
    try {
      return { success: true, data: await getPlayer().scanDirettaDevices() };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 将在线音源按原始响应字节物化为 Direct 可 seek 的进程级临时文件
  ipcMain.handle("player:materializeDirectInput", async (_event, source: string) => {
    try {
      return { success: true, data: await materializeDirectInput(source) };
    } catch (error) {
      return fail(ErrorCode.NETWORK_ERROR, error);
    }
  });

  // 获取系统默认输出设备名称
  ipcMain.handle("player:getDefaultDeviceName", () => {
    try {
      return { success: true, data: getPlayer().getDefaultDeviceName() ?? null };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 切换输出设备（传设备 ID，null 使用系统默认）
  ipcMain.handle(
    "player:setOutputDevice",
    async (_event, deviceId: string | null, pauseBeforeSwitch = false) => {
      try {
        cancelPendingReinit();
        if (pauseBeforeSwitch) getPlayer().pauseImmediately();
        await getPlayer().setOutputDevice(deviceId ?? undefined);
        return { success: true };
      } catch (error) {
        return fail(
          isNativeDeviceError(error) ? ErrorCode.DEVICE_INIT_FAILED : ErrorCode.UNKNOWN,
          error,
        );
      }
    },
  );

  // 获取当前选择的输出设备名称
  ipcMain.handle("player:getSelectedDeviceName", () => {
    try {
      return { success: true, data: getPlayer().getSelectedDeviceName() ?? null };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 渲染进程同步播放模式到托盘
  ipcMain.on("player:syncPlayMode", (_event, repeat: RepeatMode, shuffle: ShuffleMode) => {
    setTrayPlayMode(repeat, shuffle);
  });

  // 渲染进程同步当前歌曲喜欢状态到托盘与缩略图工具栏
  ipcMain.on("player:syncLikeState", (_event, liked: boolean) => {
    setTrayLikeState(liked);
    getThumbar()?.updateLike(liked);
  });

  // 转发渲染端发起的播放控制
  ipcMain.on("player:dispatch", (_event, type: string) => {
    sendToMain("player:event", { type });
  });

  // 系统媒体事件处理
  mediaService.onEvent((event: MediaEvent) => {
    try {
      const inst = getPlayer();
      switch (event.type) {
        case "Play":
          void inst.play().catch(() => {});
          break;
        case "Pause":
          inst.pause();
          break;
        case "Stop":
          inst.stop();
          break;
        case "Seek":
          if (event.positionMs != null) {
            const targetMs = event.positionMs;
            sendToMain("player:event", { type: "seek", data: { position: targetMs } });
            void inst.seek(targetMs / 1000).then(() => {
              mediaService.setTimeline({
                currentMs: targetMs,
                totalMs: toMs(inst.getDuration()),
                seeked: true,
              });
            });
          }
          break;
        case "SetVolume":
          if (event.volume != null) {
            if (0 <= event.volume && event.volume <= 1) {
              inst.setVolume(event.volume);
              mediaService.setVolume(event.volume);
              sendToMain("player:event", {
                type: "status",
                data: {
                  state: inst.getStatus().state as PlayerState,
                  position: toDisplayPositionMs(toMs(inst.getPosition())),
                  duration: toDisplayDurationMs(toMs(inst.getDuration())),
                  volume: event.volume,
                  speed: inst.getSpeed(),
                  isFinished: false,
                },
              });
            } else {
              playerLog.warn(`无效的音量值: ${event.volume}`);
            }
          }
          break;
        case "SetRate":
          if (event.rate != null) {
            if (0.5 <= event.rate && event.rate <= 2.0) {
              inst.setSpeed(event.rate);
              mediaService.setRate(event.rate);
              nowPlaying.onSpeedChange(event.rate);
              sendToMain("player:event", {
                type: "status",
                data: {
                  state: inst.getStatus().state as PlayerState,
                  position: toDisplayPositionMs(toMs(inst.getPosition())),
                  duration: toDisplayDurationMs(toMs(inst.getDuration())),
                  volume: inst.getVolume(),
                  speed: event.rate,
                  isFinished: false,
                },
              });
            } else {
              playerLog.warn(`无效的播放速率值: ${event.rate}`);
            }
          }
          break;
        case "NextTrack":
          sendToMain("player:event", { type: "next" });
          break;
        case "PrevTrack":
          sendToMain("player:event", { type: "prev" });
          break;
      }
    } catch {}
  });

  // 系统休眠唤醒后重建音频输出设备
  const resumeHandler = async (): Promise<void> => {
    const inst = getPlayer();
    // 延迟重试：系统唤醒后音频子系统可能需要时间恢复
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [500, 1500, 3000];
    for (let i = 0; i < MAX_RETRIES; i++) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[i]));
      try {
        await inst.reinitOutput();
        playerLog.info(`唤醒后重建音频输出成功（第 ${i + 1} 次尝试）`);
        return;
      } catch (error) {
        playerLog.warn(`重建音频输出第 ${i + 1} 次失败:`, error);
      }
    }
    // 全部重试失败，销毁损坏的实例
    playerLog.error("重建音频输出全部失败，销毁播放器实例");
    resetPlayer();
    stopDeviceMonitoring();
    const stoppedEvent = {
      type: "status",
      data: { state: "stopped", position: 0, duration: 0, volume: 1, speed: 1, isFinished: false },
    };
    sendToMain("player:event", stoppedEvent);
    wsBroadcast(stoppedEvent);
  };
  powerMonitor.on("resume", resumeHandler);
  // 退出前停止设备监听、释放播放器并清理进程级 Direct 输入
  app.on("before-quit", stopDeviceMonitoring);
  app.on("before-quit", () => {
    resetPlayer();
    void cleanupDirectInputs();
  });
};
