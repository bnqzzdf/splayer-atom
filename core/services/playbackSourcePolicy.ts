import { ErrorCode } from "../../shared/types/errors";
import type { MusicUrlUnavailableReason, PluginQuality } from "../../shared/types/plugin";
import type { RepeatMode, ShuffleMode, Track } from "../../shared/types/player";

export type PlaybackCacheKeyTrack = Pick<Track, "id" | "source" | "serverId" | "originalId">;

/** Core 播放缓存键策略；仅表达 canonical Track + Core policy，不执行 I/O。 */
export const playbackSourceCacheKey = (
  track: PlaybackCacheKeyTrack,
  quality: PluginQuality,
): string | null => {
  if (track.source === "streaming" && track.serverId && track.originalId) {
    return `s:${track.serverId}:${track.originalId}:`;
  }
  if (
    (track.source === "netease" || track.source === "qobuz" || track.source === "tidal") &&
    track.id
  ) {
    return `o:${track.source}:${track.id}:${quality}`;
  }
  if ((track.source === "qqmusic" || track.source === "kugou") && track.id) {
    return `o:${track.source}:${track.id}:`;
  }
  return null;
};

const SKIPPABLE_PLAYBACK_ERRORS = new Set<string>([
  ErrorCode.FILE_NOT_FOUND,
  ErrorCode.FILE_NO_AUDIO_STREAM,
  ErrorCode.FILE_DECODE_ERROR,
  ErrorCode.NETWORK_ERROR,
  ErrorCode.NETWORK_TIMEOUT,
  ErrorCode.URL_RESOLVE_FAILED,
  ErrorCode.NO_PLUGIN_AVAILABLE,
  ErrorCode.NETEASE_LOGIN_EXPIRED,
  ErrorCode.NETEASE_VIP_REQUIRED,
  ErrorCode.NETEASE_PURCHASE_REQUIRED,
  ErrorCode.NETEASE_TRIAL_DISABLED,
  ErrorCode.NETEASE_UNAVAILABLE,
  ErrorCode.PROVIDER_VIP_REQUIRED,
  ErrorCode.PROVIDER_PURCHASE_REQUIRED,
  ErrorCode.PROVIDER_TRIAL_DISABLED,
  ErrorCode.PROVIDER_UNAVAILABLE,
  ErrorCode.PROVIDER_LOGIN_REQUIRED,
]);

/** 单曲级失败可由 Core 有界跳过；设备类/全局错误必须留给用户处理。 */
export const isSkippablePlaybackError = (code: string): boolean =>
  SKIPPABLE_PLAYBACK_ERRORS.has(code);

/** 网易无 URL 时按 fee 区分会员权益与数字单曲购买限制。 */
export const neteaseUnavailableErrorCode = (fee: unknown): ErrorCode => {
  const value = Number(fee);
  if (value === 1) return ErrorCode.NETEASE_VIP_REQUIRED;
  if (value === 4) return ErrorCode.NETEASE_PURCHASE_REQUIRED;
  return ErrorCode.NETEASE_UNAVAILABLE;
};

/** 插件上报的结构化原因 → 平台中立错误码。 */
export const pluginUnavailableErrorCode = (reason: MusicUrlUnavailableReason): ErrorCode => {
  if (reason === "vip") return ErrorCode.PROVIDER_VIP_REQUIRED;
  if (reason === "purchase") return ErrorCode.PROVIDER_PURCHASE_REQUIRED;
  if (reason === "trial") return ErrorCode.PROVIDER_TRIAL_DISABLED;
  return ErrorCode.PROVIDER_UNAVAILABLE;
};

/** 文案归类规则；顺序即优先级。 */
const PLUGIN_FAILURE_PATTERNS: ReadonlyArray<readonly [RegExp, ErrorCode]> = [
  [
    /购买|数字专辑|数字单曲|付费专辑|purchase|need\s*to\s*buy|buy\s*album/i,
    ErrorCode.PROVIDER_PURCHASE_REQUIRED,
  ],
  [/试听|trial|preview/i, ErrorCode.PROVIDER_TRIAL_DISABLED],
  [/vip|会员|绿钻|豪华绿钻|开通会员|member|privilege/i, ErrorCode.PROVIDER_VIP_REQUIRED],
  [
    /无版权|下架|暂无|不可用|copyright|unavailable|not\s*available|下架/i,
    ErrorCode.PROVIDER_UNAVAILABLE,
  ],
];

/**
 * 无结构化原因时，按插件抛出的错误文案归类。
 *
 * 上游 lx 插件只会抛一条文案，因此这里做**保守**归类：认不出来时返回 null，
 * 由调用方退回通用的 `URL_RESOLVE_FAILED`，不伪造权益结论。
 */
export const classifyPluginFailureMessage = (message: unknown): ErrorCode | null => {
  if (typeof message !== "string" || !message) return null;
  for (const [pattern, code] of PLUGIN_FAILURE_PATTERNS) {
    if (pattern.test(message)) return code;
  }
  return null;
};

/** Native sourceError 只允许在线/流媒体输入对同一 canonical Track fresh resolve 一次。 */
export const shouldRetryPlaybackSource = (
  track: Pick<Track, "source">,
  attempts: number,
): boolean => track.source !== "local" && attempts < 1;

/** 返回当前权威队列中可稳定预解析的下一项；shuffle 轮末需等 next() 完成重排。 */
export const nextPlaybackPreloadIndex = (
  index: number,
  queueLength: number,
  repeat: RepeatMode,
  shuffle: ShuffleMode,
  shouldSkip: (candidateIndex: number) => boolean = () => false,
): number | null => {
  if (index < 0 || queueLength <= 1 || repeat === "one") return null;
  if (repeat === "off" && index >= queueLength - 1) return null;
  let candidateIndex = index;
  for (let checked = 0; checked < queueLength - 1; checked++) {
    if (shuffle === "on" && candidateIndex >= queueLength - 1) return null;
    candidateIndex = candidateIndex + 1 >= queueLength ? 0 : candidateIndex + 1;
    if (!shouldSkip(candidateIndex)) return candidateIndex;
  }
  return null;
};
