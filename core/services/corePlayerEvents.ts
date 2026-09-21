import type { PlayerState } from "@shared/types/player";
import type { JsPlayerEvent } from "@splayer/audio-engine";
import { onPlayerCreated } from "@main/services/engine";
import * as playbackSession from "@main/services/playbackSession";
import * as nowPlaying from "@main/services/nowPlaying";
import * as neteaseScrobble from "@main/services/neteaseScrobble";
import * as listenbrainz from "@main/services/listenbrainz";
import { onCorePlayerEnded, onCorePlayerState } from "@main/services/headlessPlayStats";
import { wsBroadcast } from "@main/server/broadcast";
import { publishCoreControlEvent } from "@main/services/coreControlEvents";
import { toDisplayDurationMs, toDisplayPositionMs } from "@main/services/playerTimeline";
import { toMs } from "@main/utils/time";
import { playerLog } from "@main/utils/logger";

type AudioEngineModule = typeof import("@splayer/audio-engine");
type PlayerInstance = InstanceType<AudioEngineModule["AudioPlayer"]>;

/** Node Core 原生事件入口。 */
const attachCorePlayerEvents = (player: PlayerInstance): void => {
  player.onEvent((event: JsPlayerEvent) => {
    switch (event.type) {
      case "stateChanged": {
        const state = (event.state ?? "idle") as PlayerState;
        onCorePlayerState(state);
        nowPlaying.onPlayStateChange(state);
        neteaseScrobble.onState(state === "playing");
        listenbrainz.onState(state === "playing");
        const status = playbackSession.getPlaybackStatus();
        publishCoreControlEvent({
          type: "status",
          data: {
            ...status,
            state,
            isFinished: false,
          },
        });
        break;
      }
      case "ended": {
        onCorePlayerEnded();
        const consumedBySession = playbackSession.onNativeEnded();
        wsBroadcast({ type: "ended", data: { consumedBySession } });
        neteaseScrobble.onEnded();
        listenbrainz.onEnded();
        break;
      }
      case "directTrackBoundary": {
        const duration = toMs(event.duration ?? 0);
        const generation = event.generation ?? 0;
        neteaseScrobble.onEnded();
        listenbrainz.onEnded();
        const consumedBySession = playbackSession.onNativeDirectTrackBoundary(generation, duration);
        if (!consumedBySession) {
          wsBroadcast({ type: "directTrackBoundary", data: { duration, generation } });
        }
        break;
      }
      case "processedTrackBoundary": {
        const duration = toMs(event.duration ?? 0);
        const generation = event.generation ?? 0;
        neteaseScrobble.onEnded();
        listenbrainz.onEnded();
        const consumedBySession = playbackSession.onNativeProcessedTrackBoundary(
          generation,
          duration,
        );
        if (!consumedBySession) {
          wsBroadcast({ type: "processedTrackBoundary", data: { duration, generation } });
        }
        break;
      }
      case "sourceError": {
        const consumedBySession = playbackSession.onNativeSourceError();
        wsBroadcast({ type: "sourceError", data: { consumedBySession } });
        neteaseScrobble.onState(false);
        listenbrainz.onState(false);
        break;
      }
      case "position": {
        const enginePositionMs = toMs(event.position ?? 0);
        if (playbackSession.onNativePosition(enginePositionMs)) {
          onCorePlayerEnded();
          wsBroadcast({ type: "ended", data: { consumedBySession: true } });
          neteaseScrobble.onEnded();
          listenbrainz.onEnded();
          break;
        }
        const positionMs = toDisplayPositionMs(enginePositionMs);
        const durationMs = toDisplayDurationMs(toMs(event.duration ?? 0));
        nowPlaying.onPosition(positionMs, true);
        neteaseScrobble.onPosition(positionMs);
        publishCoreControlEvent({
          type: "position",
          data: { position: positionMs, duration: durationMs },
        });
        break;
      }
      case "outputFailed":
      case "outputStalled": {
        playerLog.warn(`[core] native ${event.type}, playback paused for explicit recovery`);
        player.markOutputUnavailable();
        break;
      }
      case "fftData":
        break;
    }
  });
};

/** 必须在首次 getPlayer() 之前调用，确保 Core 能消费全部 native 事件。 */
export const registerCorePlayerEvents = (): void => {
  onPlayerCreated(attachCorePlayerEvents);
};
