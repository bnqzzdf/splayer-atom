import type {
  CommentSource,
  CommentsApi,
  MusicCommentQuery,
  MusicCommentResponse,
} from "@shared/types/comment";
import type { Track } from "@shared/types/player";
import { serverAssetUrl } from "./controlAssets";
import { request } from "./controlClient";

const toServerTrack = (track: Track): Track => ({
  ...track,
  cover: serverAssetUrl(track.cover),
  coverOriginal: serverAssetUrl(track.coverOriginal),
});

/** Web Control 的 Core Comments request client。 */
export const commentsClient: CommentsApi = {
  sources: () => request<CommentSource[]>("/comments/sources"),
  get: (args: MusicCommentQuery) =>
    request<MusicCommentResponse>("/comments/music", {
      method: "POST",
      body: JSON.stringify({ ...args, track: toServerTrack(args.track) }),
    }).catch((error) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    })),
};
