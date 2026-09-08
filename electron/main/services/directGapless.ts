import type { LyricFormat } from "@shared/types/lyrics";
import type { DirectStageResult, PlaybackContext, Track } from "@shared/types/player";
import { getPlayer } from "@main/services/engine";
import { clearActiveCueRange } from "@main/services/playerTimeline";
import { isCurrentPlayerLoadSeq, nextPlayerLoadSeq } from "@main/services/playerLoad";
import { pruneDirectInputs } from "@main/atom/directInput";
import {
  notifyPlaybackTrackLoaded,
  setPlaybackPresentationCover,
  updatePlaybackPresentation,
} from "@main/atom/runtime/playbackPresentation";
import { fetchBytes } from "@main/utils/fetchBytes";
import { formatArtists } from "@main/utils/metadata";
import { playerLog } from "@main/utils/logger";
import * as neteaseScrobble from "@main/services/neteaseScrobble";
import * as listenbrainz from "@main/services/listenbrainz";
import { beginCorePlayStats } from "@main/services/headlessPlayStats";

/** 使用现有 native Direct runtime 预备同 wire-format 下一首。 */
export const stageDirectPlaybackNext = async (
  source: string,
  durationMs: number,
  generation: number,
): Promise<DirectStageResult> => {
  try {
    const safeGeneration = Math.max(0, Math.min(0xffff_ffff, Math.trunc(generation)));
    const player = getPlayer();
    const staged = await player.stageDirectNext(
      source,
      Math.max(0, durationMs) / 1000,
      safeGeneration,
    );
    if (!staged) return { staged: false };

    try {
      const meta = await player.probeMetadata(source);
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
 * native 已在同一 Diretta connection 上完成 boundary 后，结算新曲展示/统计状态。
 * 不执行 normal load，也不拥有 queue index；queue 由 PlaybackSession 提交。
 */
export const commitDirectPlaybackBoundary = (
  source: string,
  durationMs: number,
  track?: Track,
  context?: PlaybackContext,
): void => {
  getPlayer().commitDirectGaplessBoundary(source, Math.max(0, durationMs) / 1000);
  void pruneDirectInputs(source);
  clearActiveCueRange();
  const seq = nextPlayerLoadSeq();
  if (!track) return;

  const title = track.title || source.split(/[/\\]/).pop() || source;
  const artist = formatArtists(track.artists ?? []);
  const album = track.album?.name ?? "";
  const coverCandidate = track.coverOriginal ?? track.cover;
  const coverUrl =
    coverCandidate && /^https?:\/\//i.test(coverCandidate) ? coverCandidate : undefined;
  const display = { title, artist, album, coverUrl, durationMs, autoPlay: true } as const;

  updatePlaybackPresentation(display);
  notifyPlaybackTrackLoaded(track, context, {
    ...display,
    artist: track.artists?.[0]?.name ?? artist,
  });
  beginCorePlayStats({ ...track, duration: track.duration || durationMs }, true);
  neteaseScrobble.onTrackLoaded(track, context, durationMs, true);
  listenbrainz.onTrackLoaded(track, durationMs, true);

  if (coverUrl) {
    void fetchBytes(coverUrl).then((coverData) => {
      if (!coverData || !isCurrentPlayerLoadSeq(seq)) return;
      updatePlaybackPresentation({ ...display, coverData });
      setPlaybackPresentationCover(coverData);
    });
  }
};
