import type {
  DownloadApi,
  DownloadRequest,
  DownloadTask,
  EnqueueResult,
} from "@shared/types/download";
import type { Track } from "@shared/types/player";
import { controlAssetUrl, serverAssetUrl } from "./controlAssets";
import { request } from "./controlClient";

type CoreDownloadClient = Omit<DownloadApi, "pickDir">;

const mapTrack = (track: Track): Track => ({
  ...track,
  cover: controlAssetUrl(track.cover),
  coverOriginal: controlAssetUrl(track.coverOriginal),
});

const mapTask = (task: DownloadTask): DownloadTask => ({
  ...task,
  track: mapTrack(task.track),
});

const toServerTrack = (track: Track): Track => ({
  ...track,
  cover: serverAssetUrl(track.cover),
  coverOriginal: serverAssetUrl(track.coverOriginal),
});

const toServerRequest = (value: DownloadRequest): DownloadRequest => ({
  ...value,
  track: toServerTrack(value.track),
  coverUrl: serverAssetUrl(value.coverUrl),
});

/** Web Control 的 Core Download request client。 */
export const downloadClient: CoreDownloadClient = {
  start: (value) =>
    request<EnqueueResult>("/download/start", {
      method: "POST",
      body: JSON.stringify(toServerRequest(value)),
    }),
  startMany: (values) =>
    request<EnqueueResult[]>("/download/start-many", {
      method: "POST",
      body: JSON.stringify(values.map(toServerRequest)),
    }),
  retry: (value) =>
    request<EnqueueResult>("/download/start", {
      method: "POST",
      body: JSON.stringify(toServerRequest(value)),
    }),
  cancel: async (taskId) => {
    await request("/download/cancel", {
      method: "POST",
      body: JSON.stringify({ taskId }),
    });
  },
  remove: async (taskId) => {
    await request("/download/remove", {
      method: "POST",
      body: JSON.stringify({ taskId }),
    });
  },
  clearFinished: async () => {
    await request("/download/clear-finished", { method: "POST" });
  },
  list: async () => (await request<DownloadTask[]>("/download/tasks")).map(mapTask),
  getDir: async () => (await request<{ dir: string }>("/download/dir")).dir,
  setDir: async (dir) =>
    (
      await request<{ dir: string }>("/download/dir", {
        method: "POST",
        body: JSON.stringify({ dir }),
      })
    ).dir,
  resetDir: async () =>
    (await request<{ dir: string }>("/download/reset-dir", { method: "POST" })).dir,
};
