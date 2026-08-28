import type { PlaybackContext, Track } from "@shared/types/player";

export interface PlaybackPresentationState {
  title: string;
  artist: string;
  album: string;
  coverData?: Buffer;
  coverUrl?: string;
  durationMs: number;
  autoPlay: boolean;
}

export interface PlaybackPresentationAdapter {
  update(state: PlaybackPresentationState): void;
  setCover(cover: Buffer | string | undefined): void;
  onTrackLoaded(
    track: Track | null,
    context: PlaybackContext | undefined,
    display: PlaybackPresentationState,
  ): void;
}

let adapter: PlaybackPresentationAdapter | null = null;

/** Desktop shell 注册播放展示副作用；Node Core 不注册时保持纯业务执行。 */
export const setPlaybackPresentationAdapter = (next: PlaybackPresentationAdapter | null): void => {
  adapter = next;
};

export const updatePlaybackPresentation = (state: PlaybackPresentationState): void => {
  adapter?.update(state);
};

export const setPlaybackPresentationCover = (cover: Buffer | string | undefined): void => {
  adapter?.setCover(cover);
};

export const notifyPlaybackTrackLoaded = (
  track: Track | null,
  context: PlaybackContext | undefined,
  display: PlaybackPresentationState,
): void => {
  adapter?.onTrackLoaded(track, context, display);
};
