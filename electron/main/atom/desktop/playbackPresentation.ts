import { getMainWindow } from "@main/window";
import { appName } from "@main/utils/config";
import * as lastfm from "@main/services/lastfm";
import * as mediaService from "@main/services/media";
import { setTaskbarThumbnailCover } from "@main/services/thumbnail";
import { setTrayPlayState, setTraySongName } from "@main/services/tray";
import {
  setPlaybackPresentationAdapter,
  type PlaybackPresentationState,
} from "@main/atom/runtime/playbackPresentation";

const update = (state: PlaybackPresentationState): void => {
  const header = state.artist ? `${state.title} - ${state.artist}` : state.title || appName;
  mediaService.setMetadata({
    title: state.title,
    artist: state.artist,
    album: state.album,
    coverData: state.coverData,
    coverUrl: state.coverUrl,
    durationMs: state.durationMs,
  });
  mediaService.setPlayState({ status: state.autoPlay ? "Playing" : "Paused" });
  getMainWindow()?.setTitle(header);
  setTraySongName(header);
  setTrayPlayState(state.autoPlay ? "playing" : "paused");
};

/** Electron Desktop 注册本机窗口、媒体控件、托盘与 Last.fm 展示副作用。 */
export const registerDesktopPlaybackPresentation = (): void => {
  setPlaybackPresentationAdapter({
    update,
    setCover: setTaskbarThumbnailCover,
    onTrackLoaded: (_track, _context, display) => {
      lastfm.onTrackLoaded({
        title: display.title,
        artist: display.artist,
        album: display.album,
        durationMs: display.durationMs,
        autoPlay: display.autoPlay,
      });
    },
  });
};
