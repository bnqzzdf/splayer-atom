/**
 * 播放控制聚合入口
 *
 * 把 HTTP/WS 与控制类插件发起的播放控制收敛到 Core playback session。
 */

import { getPlayer } from "@main/services/engine";
import * as playbackSession from "@main/services/playbackSession";
import { toMs } from "@main/utils/time";
import type { ShuffleMode, RepeatMode, Track } from "@shared/types/player";

/**
 * 跳转（毫秒）
 *
 * 返回的 Promise 透传引擎结果：WS/REST 等外部入口据此反馈失败；插件侧即发即忘，自行忽略即可。
 * @param positionMs - 目标位置（毫秒）
 */
const seek = (positionMs: number): Promise<void> => {
  return playbackSession.seek(positionMs);
};

export const playerControl = {
  play: (): void => void playbackSession.play().catch(() => {}),
  pause: (): void => playbackSession.pause(),
  stop: (): void => playbackSession.stop(),
  next: (): void => void playbackSession.next(),
  prev: (): void => void playbackSession.prev(),
  setShuffle: (mode: ShuffleMode): void => void playbackSession.setShuffle(mode),
  setRepeat: (mode: RepeatMode): void => void playbackSession.setRepeat(mode),
  playTrack: (track: Track): void => void playbackSession.playTrack(track),
  addToQueue: (tracks: Track[], position: "next" | "end"): void => {
    const items = tracks.map((track) => ({ track }));
    if (position === "end") {
      playbackSession.appendQueue(items);
      return;
    }
    const session = playbackSession.getPlaybackSession();
    playbackSession.insertQueue(items, Math.min(session.index + 1, session.queue.length));
  },
  seek,
  setVolume: (volume: number): void => {
    playbackSession.assertSampleProcessingAvailable();
    getPlayer().setVolume(volume);
  },
  setSpeed: (speed: number): void => {
    playbackSession.assertSampleProcessingAvailable();
    getPlayer().setSpeed(speed);
  },
  setPitch: (semitones: number): void => {
    playbackSession.assertSampleProcessingAvailable();
    getPlayer().setPitch(semitones);
  },
  setPitchSync: (enabled: boolean): void => {
    playbackSession.assertSampleProcessingAvailable();
    getPlayer().setPitchSync(enabled);
  },
  setNormalizationEnabled: (enabled: boolean): void => {
    playbackSession.assertSampleProcessingAvailable();
    getPlayer().setNormalizationEnabled(enabled);
  },
  setEqualizerBands: (bands: number[]): void => {
    playbackSession.assertSampleProcessingAvailable();
    getPlayer().setEqualizerBands(bands);
  },
  setPreampGain: (preamp: number): void => {
    playbackSession.assertSampleProcessingAvailable();
    getPlayer().setPreampGain(preamp);
  },
  setEqualizerEnabled: (enabled: boolean): void => {
    playbackSession.assertSampleProcessingAvailable();
    getPlayer().setEqualizerEnabled(enabled);
  },
  setFadeDuration: (durationMs: number): void => {
    playbackSession.assertSampleProcessingAvailable();
    getPlayer().setFadeDuration(durationMs);
  },
  /** 通过 Core authoritative session 重建当前本地输出。 */
  reinitOutput: (): Promise<void> => playbackSession.reinitOutput(),
  /** 当前播放进度（毫秒） */
  getPosition: (): number => toMs(getPlayer().getPosition()),
};
