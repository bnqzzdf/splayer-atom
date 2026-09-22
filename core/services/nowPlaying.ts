import { EventEmitter } from "node:events";
import type { Track, TrackDetail, PlayerState } from "@shared/types/player";
import type { LyricData } from "@shared/types/lyrics";
import { lyricOffsetSourceKey } from "@shared/types/lyrics";
import type {
  NowPlayingSnapshot,
  NowPlayingPositionSync,
  NowPlayingLyricOffsetSync,
} from "@shared/types/nowPlaying";
import { store } from "@main/store";
import { publishCoreControlEvent } from "@main/services/coreControlEvents";

type NowPlayingEvents = {
  /** 歌曲切换 */
  "track-change": [{ track: Track | null }];
  /** 播放位置锚点 */
  "position-sync": [NowPlayingPositionSync];
  /** 当前曲目歌词偏移变化 */
  "lyric-offset-change": [NowPlayingLyricOffsetSync];
};

/** 当前歌曲轻量信息 */
let currentTrack: Track | null = null;
/** 当前实际加载完成时解析出的媒体详情；用于晚连接 Control 恢复本地/内嵌歌词。 */
let currentDetail: TrackDetail | null = null;
/** 最近一次播放位置（毫秒） */
let lastPosition = 0;
/** lastPosition 真实成立的墙钟时刻（Date.now 毫秒），用于补偿其过期时长 */
let lastPositionAt = 0;
/** 当前是否处于播放态 */
let playing = false;
/** 完整播放状态，区分 stopped 与 paused */
let playState: PlayerState = "idle";
/** 当前播放速度倍率（0.5 ~ 2.0） */
let playSpeed = 1.0;

/** 内部事件总线 */
const emitter = new EventEmitter<NowPlayingEvents>();

const emitLyricOffsetChange = (data: NowPlayingLyricOffsetSync): void => {
  emitter.emit("lyric-offset-change", data);
  publishCoreControlEvent({ type: "lyricOffset", data });
};

/**
 * 偏移存储 key：按（曲目, 歌词源）区分，各来源时间轴独立，在线歌词按平台再分
 * @param trackId - 曲目 ID
 * @param source - 歌词源，null（歌词未加载）时退化为裸 trackId
 */
const offsetKey = (trackId: string, source: LyricData): string => {
  const sourceKey = lyricOffsetSourceKey(source);
  return sourceKey ? `${trackId}|${sourceKey}` : trackId;
};

/**
 * 从存储中读取指定曲目当前歌词源的偏移
 * @param trackId - 曲目 ID
 * @param source - 歌词源
 * @returns 偏移值（毫秒），缺省视为 0
 */
const readOffset = (trackId: string | null | undefined, source: LyricData): number => {
  if (!trackId) return 0;
  return store.get("player.lyricOffsets")?.[offsetKey(trackId, source)] ?? 0;
};

/**
 * 同步当前播放状态
 * @param track - 当前曲目
 * @param detail - 当前加载完成后的媒体详情
 */
export const update = (track: Track | null, detail: TrackDetail | null = null): void => {
  const trackChanged = (currentTrack?.id ?? null) !== (track?.id ?? null);
  currentTrack = track;
  currentDetail = detail;
  if (trackChanged) {
    // 重置播放进度
    lastPosition = 0;
    lastPositionAt = Date.now();
    emitter.emit("track-change", { track });
  }
};

/**
 * 同步播放位置
 * @param positionMs - 播放位置（毫秒）
 * @param isPlaying - 是否处于播放态
 */
export const onPosition = (positionMs: number, isPlaying: boolean): void => {
  lastPosition = positionMs;
  lastPositionAt = Date.now();
  playing = isPlaying;
  if (isPlaying) playState = "playing";
  emitter.emit("position-sync", {
    position: positionMs,
    playing: isPlaying,
    state: playState,
    speed: playSpeed,
    sendTimestamp: lastPositionAt,
  });
};

/**
 * 同步播放状态
 * @param state - 引擎播放状态（idle/loading/playing/paused/stopped）
 */
export const onPlayStateChange = (state: PlayerState): void => {
  playState = state;
  playing = state === "playing";
  emitter.emit("position-sync", {
    position: lastPosition,
    playing,
    state,
    speed: playSpeed,
    // 暂停态接收端不补偿延迟，恢复态不能用陈旧时间戳，故取当前时刻
    sendTimestamp: Date.now(),
  });
};

/**
 * 同步播放速度
 * @param speed - 播放速度倍率（0.5 ~ 2.0）
 *
 * 立即广播一帧 position-sync，让窗口当帧换挡，无需等待下一个 5Hz 周期
 */
export const onSpeedChange = (speed: number): void => {
  playSpeed = Number.isFinite(speed) ? speed : 1.0;
  emitter.emit("position-sync", {
    position: lastPosition,
    playing,
    state: playState,
    speed: playSpeed,
    sendTimestamp: lastPositionAt || Date.now(),
  });
};

/**
 * 单曲偏移的合理上限（毫秒）
 * 超过视为误输入，clamp 防止极端值
 */
const LYRIC_OFFSET_LIMIT_MS = 60_000;

/**
 * 写入指定曲目的歌词偏移；0 视为清除
 * 偏移跟随当前歌词源，持久化到 store 并在影响当前曲目时广播
 * @param trackId - 目标 Track.id
 * @param offsetMs - 偏移值（毫秒），自动 clamp 到 ±60s
 */
export const setLyricOffset = (trackId: string, source: LyricData, offsetMs: number): void => {
  if (!trackId) return;
  // IPC 进来可能是 NaN/Infinity，会污染所有下游时间叠加计算，统一视为清除
  const normalized = Number.isFinite(offsetMs) ? Math.trunc(offsetMs) : 0;
  const value = Math.max(-LYRIC_OFFSET_LIMIT_MS, Math.min(LYRIC_OFFSET_LIMIT_MS, normalized));
  const key = offsetKey(trackId, source);
  const map = { ...(store.get("player.lyricOffsets") ?? {}) };
  if (value === 0) delete map[key];
  else map[key] = value;
  store.set("player.lyricOffsets", map);
  emitLyricOffsetChange({ trackId, source, offsetMs: value });
};

/** 读取指定曲目、指定歌词源的偏移。 */
export const getLyricOffset = (trackId: string, source: LyricData): number =>
  readOffset(trackId, source);

/** 拉取当前实际加载完成的播放状态。 */
export const snapshot = (): NowPlayingSnapshot => ({
  track: currentTrack,
  detail: currentDetail,
  position: lastPosition,
  playing,
  state: playState,
  speed: playSpeed,
  // 用 position 的成立时刻，接收端据此补偿其过期时长
  sendTimestamp: lastPositionAt || Date.now(),
});

export const lightSnapshot = snapshot;

/** 清空 */
export const clear = (): void => {
  currentTrack = null;
  currentDetail = null;
};

/** 订阅歌曲切换 */
export const onTrackChange = (listener: (data: { track: Track | null }) => void): (() => void) => {
  emitter.on("track-change", listener);
  return () => emitter.off("track-change", listener);
};

/** 订阅播放位置锚点 */
export const onPositionSync = (listener: (data: NowPlayingPositionSync) => void): (() => void) => {
  emitter.on("position-sync", listener);
  return () => emitter.off("position-sync", listener);
};

/** 订阅当前曲目歌词偏移变化 */
export const onLyricOffsetChange = (
  listener: (data: NowPlayingLyricOffsetSync) => void,
): (() => void) => {
  emitter.on("lyric-offset-change", listener);
  return () => emitter.off("lyric-offset-change", listener);
};
