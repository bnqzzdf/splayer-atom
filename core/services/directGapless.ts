import type { LyricFormat } from "@shared/types/lyrics";
import type { DirectStageResult, PlaybackContext, Track } from "@shared/types/player";
import { getPlayer } from "@main/services/engine";
import { directCueSegmentFromTrack, setActiveCueTrack } from "@main/services/playerTimeline";
import {
  localMediaInfoFromNativeMetadata,
  nextPlayerLoadSeq,
} from "@main/services/playerLoad";
import { pruneDirectInputs } from "@main/atom/directInput";
import { playerLog } from "@main/utils/logger";
import * as neteaseScrobble from "@main/services/neteaseScrobble";
import * as listenbrainz from "@main/services/listenbrainz";
import { beginCorePlayStats } from "@main/services/headlessPlayStats";

/** 使用现有 native Direct runtime 预备同 wire-format 下一首。 */
export const stageDirectPlaybackNext = async (
  source: string,
  durationMs: number,
  generation: number,
  cueStartFrame75?: number,
  cueEndFrame75?: number,
): Promise<DirectStageResult> => {
  try {
    const safeGeneration = Math.max(0, Math.min(0xffff_ffff, Math.trunc(generation)));
    const player = getPlayer();
    const staged = await player.stageDirectNext(
      source,
      Math.max(0, durationMs) / 1000,
      safeGeneration,
      cueStartFrame75,
      cueEndFrame75,
    );
    if (!staged) return { staged: false };

    try {
      const meta = await player.probeMetadata(source);
      return {
        staged: true,
        mediaInfo: localMediaInfoFromNativeMetadata(meta),
        detail: {
          quality: {
            sampleRate: meta.originalSampleRate,
            channels: meta.channels,
            bitsPerSample: meta.bitsPerSample,
            bitRate: meta.bitRate,
            codec: meta.codec,
          },
          embeddedLyric: meta.embeddedLyric,
          externalLyrics: meta.externalLyrics.map((item) => ({
            path: item.path,
            format: item.format as LyricFormat,
          })),
        },
      };
    } catch (error) {
      playerLog.debug(`Direct staging metadata probe 未命中: ${String(error)}`);
      return { staged: true };
    }
  } catch (error) {
    playerLog.debug(`Direct gapless staging 未命中: ${String(error)}`);
    return { staged: false };
  }
};

export const cancelDirectPlaybackNext = (): void => {
  getPlayer().cancelDirectNext();
};

/**
 * native 已在同一 Diretta connection 上完成 boundary 后，结算新曲统计状态。
 * 不执行 normal load，也不拥有 queue index；queue 由 PlaybackSession 提交。
 */
export const commitDirectPlaybackBoundary = (
  source: string,
  durationMs: number,
  track?: Track,
  context?: PlaybackContext,
): void => {
  const segment = directCueSegmentFromTrack(track);
  getPlayer().commitDirectGaplessBoundary(
    source,
    Math.max(0, durationMs) / 1000,
    segment?.startFrame75,
    segment?.endFrame75,
  );
  void pruneDirectInputs(source);
  setActiveCueTrack(track, segment != null);
  nextPlayerLoadSeq();
  if (!track) return;
  beginCorePlayStats({ ...track, duration: track.duration || durationMs }, true);
  neteaseScrobble.onTrackLoaded(track, context, durationMs, true);
  listenbrainz.onTrackLoaded(track, durationMs, true);
};
