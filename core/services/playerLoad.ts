import { getSongCacheDir } from "@main/utils/config";
import {
  discardDirectInput,
  materializeDirectInput,
  pruneDirectInputs,
} from "@main/atom/directInput";
import { ErrorCode } from "@shared/types/errors";
import type { LyricFormat } from "@shared/types/lyrics";
import type { IpcResponse, LoadOptions, LoadResult } from "@shared/types/player";
import { getPlayer } from "@main/services/engine";
import { beginCorePlayStats } from "@main/services/headlessPlayStats";
import * as neteaseScrobble from "@main/services/neteaseScrobble";
import * as listenbrainz from "@main/services/listenbrainz";
import {
  clearActiveCueRange,
  directCueSegmentFromTrack,
  setActiveCueTrack,
  toDisplayDurationMs,
} from "@main/services/playerTimeline";
import * as songCache from "@main/services/songCache";
import { publishCoreControlEvent } from "@main/services/coreControlEvents";
import { playerLog } from "@main/utils/logger";
import { parseAlbum, parseArtists } from "@main/utils/metadata";
import { toCacheUrl } from "@main/atom/cacheUrl";
import { toMs } from "@main/utils/time";
import { isLocalDirectOutputWithMode } from "@main/services/alsaPlaybackMode";
import type { AlsaPlaybackMode } from "@shared/types/settings";
import { projectNativeEffectiveControls } from "@main/services/playerOutputStatus";

/** 每次音源加载自增，用于丢弃过期远端封面。 */
let loadSeq = 0;

/** 声明一次新的播放音源 generation。 */
export const nextPlayerLoadSeq = (): number => ++loadSeq;

/** 判断异步结果是否仍属于当前播放 generation。 */
export const isCurrentPlayerLoadSeq = (seq: number): boolean => seq === loadSeq;

/** 判断原生错误是否为设备错误。 */
const isNativeDeviceError = (error: unknown): boolean => String(error).includes("[Device]");
const isNativeSourceNotFoundError = (error: unknown): boolean =>
  String(error).includes("[SourceNotFound]");
const isNativeNetworkError = (error: unknown): boolean =>
  String(error).includes("[NetworkUnreachable]");
const isNativeCancelledError = (error: unknown): boolean => String(error).includes("[Cancelled]");

/** 根据原生错误特征和音源类型分类。 */
const classifyLoadError = (error: unknown, source: string): ErrorCode => {
  const msg = error instanceof Error ? error.message : String(error);
  if (isNativeCancelledError(error)) return ErrorCode.LOAD_SUPERSEDED;
  if (isNativeDeviceError(error) || /output device|NoDevice|DeviceNotAvailable/i.test(msg)) {
    return ErrorCode.DEVICE_NOT_FOUND;
  }
  if (isNativeSourceNotFoundError(error)) return ErrorCode.FILE_NOT_FOUND;
  if (isNativeNetworkError(error) || /^https?:\/\//i.test(source)) return ErrorCode.NETWORK_ERROR;
  return ErrorCode.FILE_DECODE_ERROR;
};

/**
 * 通过 Core 播放链加载音源。
 * @param source - 本地路径或已解析音源
 * @param options - 播放选项与权威 Track 元数据
 * @returns 与原 player:load 完全相同的响应
 */
interface PlayerLoadRuntimeOptions {
  /** 同一 canonical Track 的基础设施 reload 不重建 ListenBrainz listen session。 */
  preserveListenBrainzSession?: boolean;
  /** Direct 首播完成 native load 后，把已经完整物化的本地输入交回 Core session 复用。 */
  onDirectMaterialized?: (sourcePath: string) => void;
}

export const loadPlayerSource = async (
  source: string,
  options: LoadOptions = {},
  runtime: PlayerLoadRuntimeOptions = {},
): Promise<IpcResponse<LoadResult>> => {
  const autoPlay = options.autoPlay ?? true;
  const authoritative = options.meta ?? null;
  const isRemote = authoritative != null && authoritative.source !== "local";
  const seq = nextPlayerLoadSeq();
  let loadSource = source;
  try {
    const inst = getPlayer();
    const directOutput = isLocalDirectOutputWithMode(
      inst.getSelectedDeviceName(),
      inst.getAlsaPlaybackMode() as AlsaPlaybackMode,
    );
    const controls = projectNativeEffectiveControls(inst);
    const directCueSegment = directOutput ? directCueSegmentFromTrack(authoritative) : null;
    const cueRange = setActiveCueTrack(authoritative, directCueSegment != null);
    const loadingEvent = {
      type: "status" as const,
      data: {
        state: "loading" as const,
        position: 0,
        duration: 0,
        volume: controls.volume,
        speed: controls.speed,
        isFinished: false,
        output: controls.output,
      },
    };
    publishCoreControlEvent(loadingEvent);

    if (directOutput && /^https?:\/\//i.test(source)) {
      // Native Direct 只接收本地 seekable 输入；远端字节由 Core 原样落盘后再交给 native。
      loadSource = await materializeDirectInput(source);
    }

    const meta = await inst.load(
      loadSource,
      cueRange && !directCueSegment ? false : autoPlay,
      directCueSegment?.startFrame75,
      directCueSegment?.endFrame75,
    );
    if (loadSource !== source) runtime.onDirectMaterialized?.(loadSource);
    void pruneDirectInputs(loadSource);
    if (cueRange && !directCueSegment) {
      await inst.seek(cueRange.startMs / 1000);
      if (autoPlay) await inst.play();
    }

    const nativeDurationMs = toMs(meta.duration);
    const durationMs = toDisplayDurationMs(nativeDurationMs);
    const fallbackTitle = meta.title || source.split(/[/\\]/).pop() || source;
    const displayTitle = authoritative?.title ?? fallbackTitle;
    neteaseScrobble.onTrackLoaded(authoritative, options.context, durationMs, autoPlay);
    if (!runtime.preserveListenBrainzSession) {
      listenbrainz.onTrackLoaded(authoritative, durationMs, autoPlay);
    }

    const quality = {
      sampleRate: meta.originalSampleRate,
      channels: meta.channels,
      bitsPerSample: meta.bitsPerSample,
      bitRate: meta.bitRate,
      codec: meta.codec,
    };
    const data: LoadResult = {
      detail: {
        quality,
        embeddedLyric: meta.embeddedLyric,
        externalLyrics: meta.externalLyrics.map((item) => ({
          path: item.path,
          format: item.format as LyricFormat,
        })),
      },
      mediaInfo: {
        title: isRemote ? displayTitle : meta.title || displayTitle,
        artists: isRemote ? authoritative?.artists : parseArtists(meta.artist ?? ""),
        album: isRemote ? authoritative?.album : parseAlbum(meta.album ?? ""),
        duration: durationMs,
        cover: isRemote ? undefined : toCacheUrl(meta.cover),
        quality,
      },
    };
    if (authoritative) {
      beginCorePlayStats(
        {
          ...authoritative,
          duration: authoritative.duration || durationMs,
          cover: authoritative.cover ?? data.mediaInfo.cover,
          quality: authoritative.quality ?? quality,
        },
        autoPlay,
      );
    }
    playerLog.debug(`加载成功: ${displayTitle}`);
    return { success: true, data };
  } catch (error) {
    if (isCurrentPlayerLoadSeq(seq)) clearActiveCueRange();
    const code = classifyLoadError(error, source);
    if (code === ErrorCode.FILE_DECODE_ERROR) {
      if (loadSource.startsWith(getSongCacheDir())) void songCache.invalidate(loadSource);
      void discardDirectInput(loadSource);
    }
    playerLog.error(`${code}:`, error);
    return { success: false, error: code };
  }
};
