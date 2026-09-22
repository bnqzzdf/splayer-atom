import type { ListenBrainzStatus } from "@shared/types/listenbrainz";
import { request } from "./controlClient";

export const listenbrainzClient = {
  getStatus: (): Promise<ListenBrainzStatus> => request<ListenBrainzStatus>("/listenbrainz/status"),
  link: (token: string): Promise<ListenBrainzStatus> =>
    request<ListenBrainzStatus>("/listenbrainz/link", {
      method: "PUT",
      body: JSON.stringify({ token }),
    }),
  unlink: (): Promise<ListenBrainzStatus> =>
    request<ListenBrainzStatus>("/listenbrainz/link", { method: "DELETE" }),
  clearOutbox: (): Promise<ListenBrainzStatus> =>
    request<ListenBrainzStatus>("/listenbrainz/outbox/clear", { method: "POST" }),
};
