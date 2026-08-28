import { getMainWindow } from "@main/window";
import { appName, getSongCacheDir } from "@main/utils/config";
import {
  discardDirectInput,
  materializeDirectInput,
  pruneDirectInputs,
} from "@main/atom/directInput";
import { ErrorCode } from "@shared/types/errors";
import type { LyricFormat } from "@shared/types/lyrics";
import type { IpcResponse, LoadOptions, LoadResult } from "@shared/types/player";
import { cancelPendingReinit } from "@main/services/device";
import { getPlayer } from "@main/services/engine";
import * as lastfm from "@main/services/lastfm";
import { beginHeadlessPlayStats } from "@main/services/headlessPlayStats";
import * as mediaService from "@main/services/media";
import * as neteaseScrobble from "@main/services/neteaseScrobble";
import { clearActiveCueRange, setActiveCueTrack, toDisplayDurationMs } from "@main/services/playerTimeline";
import * as songCache from "@main/services/songCache";
import { setTaskbarThumbnailCover } from "@main/services/thumbnail";
import { setTrayPlayState, setTraySongName } from "@main/services/tray";
import { wsBroadcast } from "@main/server/broadcast";
import { sendToMain } from "@main/utils/broadcast";
import { fetchBytes } from "@main/utils/fetchBytes";
import { playerLog } from "@main/utils/logger";
import { formatArtists, parseAlbum, parseArtists } from "@main/utils/metadata";
import { toCacheUrl } from "@main/utils/protocol";
import { toMs } from "@main/utils/time";

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
 * 通过共享主进程播放链加载音源。
 * Electron IPC 与 Headless Web HTTP 都必须调用这里，避免复制播放编排。
 * @param source - 本地路径或已解析音源
 * @param options - 播放选项与权威 Track 元数据
 * @returns 与原 player:load 完全相同的响应
 */
export const loadPlayerSource = async (
  source: string,
  options: LoadOptions = {},
): Promise<IpcResponse<LoadResult>> => {
  cancelPendingReinit();
  const autoPlay = options.autoPlay ?? true;
  const authoritative = options.meta ?? null;
  const cueRange = setActiveCueTrack(authoritative);
  const isRemote = authoritative != null && authoritative.source !== "local";
  const seq = nextPlayerLoadSeq();
  let loadSource = source;
  try {
    const inst = getPlayer();
    const loadingEvent = {
      type: "status",
      data: {
        state: "loading" as const,
        position: 0,
        duration: 0,
        volume: inst.getVolume(),
        speed: inst.getSpeed(),
        isFinished: false,
      },
    };
    sendToMain("player:event", loadingEvent);
    wsBroadcast(loadingEvent);

    const remoteCover =
      authoritative && authoritative.source !== "local"
        ? (authoritative.coverOriginal ?? authoritative.cover)
        : undefined;
    const coverFetchUrl =
      remoteCover && /^(https?|streaming-cover):\/\//i.test(remoteCover) ? remoteCover : undefined;
    const coverUrl = coverFetchUrl && /^https?:\/\//i.test(coverFetchUrl) ? coverFetchUrl : undefined;

    const applyDisplay = (
      title: string,
      artist: string,
      album: string,
      coverData: Buffer | undefined,
      durationMs: number,
    ): void => {
      const header = artist ? `${title} - ${artist}` : title || appName;
      mediaService.setMetadata({ title, artist, album, coverData, coverUrl, durationMs });
      mediaService.setPlayState({ status: autoPlay ? "Playing" : "Paused" });
      getMainWindow()?.setTitle(header);
      setTraySongName(header);
      setTrayPlayState(autoPlay ? "playing" : "paused");
    };

    if (authoritative) {
      applyDisplay(
        authoritative.title || source.split(/[/\\]/).pop() || source,
        formatArtists(authoritative.artists ?? []),
        authoritative.album?.name ?? "",
        undefined,
        authoritative.duration ?? 0,
      );
    } else {
      applyDisplay(source.split(/[/\\]/).pop() || source, "", "", undefined, 0);
    }

    if (
      inst.getSelectedDeviceName()?.startsWith("diretta:") === true &&
      /^https?:\/\//i.test(source)
    ) {
      // Diretta Source Direct 只接收本地 seekable 输入；远端字节在 main 原样落盘后再交给 native。
      loadSource = await materializeDirectInput(source);
    }

    const meta = await inst.load(loadSource, cueRange ? false : autoPlay);
    void pruneDirectInputs(loadSource);
    if (cueRange) {
      await inst.seek(cueRange.startMs / 1000);
      if (autoPlay) await inst.play();
    }

    const nativeDurationMs = toMs(meta.duration);
    const durationMs = toDisplayDurationMs(nativeDurationMs);
    const fallbackTitle = meta.title || source.split(/[/\\]/).pop() || source;
    const displayTitle = authoritative?.title ?? fallbackTitle;
    const displayArtist = authoritative
      ? formatArtists(authoritative.artists ?? [])
      : formatArtists(parseArtists(meta.artist ?? ""));
    const displayAlbum = authoritative?.album?.name ?? parseAlbum(meta.album ?? "")?.name ?? "";
    const localCover = isRemote ? null : (inst.getCoverRaw() ?? null);
    applyDisplay(displayTitle, displayArtist, displayAlbum, localCover ?? undefined, durationMs);
    if (!isRemote) setTaskbarThumbnailCover(meta.cover);

    const primaryArtist =
      authoritative?.artists?.[0]?.name ?? parseArtists(meta.artist ?? "")[0]?.name ?? displayArtist;
    lastfm.onTrackLoaded({
      title: displayTitle,
      artist: primaryArtist,
      album: displayAlbum,
      durationMs,
      autoPlay,
    });
    neteaseScrobble.onTrackLoaded(authoritative, options.context, durationMs, autoPlay);

    if (coverFetchUrl) {
      void fetchBytes(coverFetchUrl).then((buf) => {
        if (!buf || !isCurrentPlayerLoadSeq(seq)) return;
        mediaService.setMetadata({
          title: displayTitle,
          artist: displayArtist,
          album: displayAlbum,
          coverData: buf,
          coverUrl,
          durationMs,
        });
        setTaskbarThumbnailCover(buf);
      });
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
        duration: durationMs,
        cover: isRemote ? undefined : toCacheUrl(meta.cover),
        quality,
      },
    };
    if (authoritative) {
      beginHeadlessPlayStats(
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
