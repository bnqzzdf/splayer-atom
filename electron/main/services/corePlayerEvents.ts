import type { PlayerState } from "@shared/types/player";
import type { JsPlayerEvent } from "@splayer/audio-engine";
import { onPlayerCreated } from "@main/services/engine";
import * as playbackSession from "@main/services/playbackSession";
import * as nowPlaying from "@main/services/nowPlaying";
import * as neteaseScrobble from "@main/services/neteaseScrobble";
import { onHeadlessPlayerEnded, onHeadlessPlayerState } from "@main/services/headlessPlayStats";
import { requestReinit } from "@main/services/device";
import { wsBroadcast } from "@main/server/broadcast";
import { publishCoreControlEvent } from "@main/services/coreControlEvents";
import { toDisplayDurationMs, toDisplayPositionMs } from "@main/services/playerTimeline";
import { toMs } from "@main/utils/time";
import { playerLog } from "@main/utils/logger";

type AudioEngineModule = typeof import("@splayer/audio-engine");
type PlayerInstance = InstanceType<AudioEngineModule["AudioPlayer"]>;

/** Node Core 原生事件入口；不包含窗口、托盘、系统媒体控件等 Desktop 副作用。 */
const attachCorePlayerEvents = (player: PlayerInstance): void => {
  player.onEvent((event: JsPlayerEvent) => {
    switch (event.type) {
      case "stateChanged": {
        const state = (event.state ?? "idle") as PlayerState;
        onHeadlessPlayerState(state);
        nowPlaying.onPlayStateChange(state);
        neteaseScrobble.onState(state === "playing");
        publishCoreControlEvent({
          type: "status",
          data: {
            state,
            position: toDisplayPositionMs(toMs(player.getPosition())),
            duration: toDisplayDurationMs(toMs(player.getDuration())),
            volume: player.getVolume(),
            speed: player.getSpeed(),
            isFinished: false,
          },
        });
        break;
      }
      case "ended": {
        onHeadlessPlayerEnded();
        const consumedBySession = playbackSession.onNativeEnded();
        wsBroadcast({ type: "ended", data: { consumedBySession } });
        neteaseScrobble.onEnded();
        break;
      }
      case "directTrackBoundary": {
        const duration = toMs(event.duration ?? 0);
        const generation = event.generation ?? 0;
        neteaseScrobble.onEnded();
        const consumedBySession = playbackSession.onNativeDirectTrackBoundary(generation, duration);
        if (!consumedBySession) {
          wsBroadcast({ type: "directTrackBoundary", data: { duration, generation } });
        }
        break;
      }
      case "sourceError": {
        const consumedBySession = playbackSession.onNativeSourceError();
        wsBroadcast({ type: "sourceError", data: { consumedBySession } });
        neteaseScrobble.onState(false);
        break;
      }
      case "position": {
        const positionMs = toDisplayPositionMs(toMs(event.position ?? 0));
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
        playerLog.warn(`[core] native ${event.type}, rebuilding output`);
        requestReinit(player);
        break;
      }
      case "fftData":
        break;
    }
  });
};

/** 必须在首次 getPlayer() 之前调用，确保 Node Core 不依赖 Electron IPC 才能消费 native 事件。 */
export const registerCorePlayerEvents = (): void => {
  onPlayerCreated(attachCorePlayerEvents);
};
