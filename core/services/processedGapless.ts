import type { LyricFormat } from "@shared/types/lyrics";
import type { PlaybackContext, Track, TrackDetail } from "@shared/types/player";
import { getPlayer } from "@main/services/engine";
import { setActiveCueTrack } from "@main/services/playerTimeline";
import { nextPlayerLoadSeq } from "@main/services/playerLoad";
import { pruneDirectInputs } from "@main/atom/directInput";
import * as neteaseScrobble from "@main/services/neteaseScrobble";
import * as listenbrainz from "@main/services/listenbrainz";
import { beginCorePlayStats } from "@main/services/headlessPlayStats";

export interface ProcessedStageResult {
  staged: boolean;
  detail?: TrackDetail;
}

/** 只准备 decoder/resampler；不会切换当前 Track，也不会创建第二个 ALSA runtime。 */
export const stageProcessedPlaybackNext = async (
  source: string,
  generation: number,
): Promise<ProcessedStageResult> => {
  const safeGeneration = Math.max(0, Math.min(0xffff_ffff, Math.trunc(generation)));
  const meta = await getPlayer().stageProcessedNext(source, safeGeneration);
  if (!meta) return { staged: false };
  return {
    staged: true,
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
};

export const cancelProcessedPlaybackNext = (): void => {
  getPlayer().cancelProcessedNext();
};

/** DAC-side boundary 后提交 native 当前 source，并启动下一首的统计/上报会话。 */
export const commitProcessedPlaybackBoundary = (
  source: string,
  durationMs: number,
  track?: Track,
  context?: PlaybackContext,
): void => {
  getPlayer().commitProcessedGaplessBoundary(source, Math.max(0, durationMs) / 1000);
  void pruneDirectInputs(source);
  setActiveCueTrack(track, false);
  nextPlayerLoadSeq();
  if (!track) return;
  beginCorePlayStats({ ...track, duration: track.duration || durationMs }, true);
  neteaseScrobble.onTrackLoaded(track, context, durationMs, true);
  listenbrainz.onTrackLoaded(track, durationMs, true);
};
