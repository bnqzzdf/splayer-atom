import type { Track, TrackDetail, PlayerState } from "./player";
import type { LyricData } from "./lyrics";

/** Core → Control：当前实际加载完成的播放快照。 */
export interface NowPlayingSnapshot {
  track: Track | null;
  detail: TrackDetail | null;
  position: number;
  playing: boolean;
  /** 完整播放状态，区分 stopped 与 paused */
  state: PlayerState;
  /** 播放速度倍率（0.5 ~ 2.0） */
  speed: number;
  /** position 真实成立的主进程时钟（Date.now 毫秒），接收端用于补偿其过期时长 */
  sendTimestamp: number;
}

/** 主进程 → 窗口：播放位置锚点 */
export interface NowPlayingPositionSync {
  position: number;
  playing: boolean;
  /** 完整播放状态，区分 stopped 与 paused */
  state: PlayerState;
  /** 播放速度倍率（0.5 ~ 2.0） */
  speed: number;
  sendTimestamp: number;
}

/** 主进程 → 渲染端 / 窗口：当前曲目歌词偏移变化（切歌或用户调整） */
export interface NowPlayingLyricOffsetSync {
  /** 对应的 Track.id */
  trackId: string;
  /** 偏移所属歌词源；不同 Web Control 可独立选择来源。 */
  source: LyricData;
  /** 当前偏移（ms） */
  offsetMs: number;
}
