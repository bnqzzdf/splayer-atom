import { afterEach, describe, expect, it, vi } from "vitest";

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const resetRuntime = (): void => {
  vi.unstubAllGlobals();
  vi.doUnmock("./controlEventClient");
  vi.resetModules();
};

afterEach(resetRuntime);

describe("Streaming Core Protocol client", () => {
  it("uses the shared Core routes for server management and sync", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ protocol: { version: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ servers: [], activeServerId: null }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "server-1",
          name: "Home",
          type: "subsonic",
          url: "http://music.local",
          username: "u",
          hasPassword: true,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ started: true }));
    vi.stubGlobal("fetch", fetchMock);

    const { streamingClient } = await import("./streamingClient");
    await streamingClient.loadServers();
    await streamingClient.addServer({
      name: "Home",
      type: "subsonic",
      url: "http://music.local",
      username: "u",
      password: "p",
    });
    await expect(streamingClient.sync("server-1", true)).resolves.toBe(true);

    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:14559/api/streaming/config");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://localhost:14559/api/streaming/server");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("http://localhost:14559/api/streaming/sync");
  });

  it("projects streaming-cover URLs for Web without losing the Core canonical form", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ protocol: { version: 1 } }))
      .mockResolvedValueOnce(
        jsonResponse({
          songs: [
            {
              id: "track-1",
              title: "Track",
              source: "streaming",
              serverId: "server-1",
              originalId: "remote-1",
              artists: [],
              duration: 1000,
              cover: "streaming-cover://image?serverId=server-1&coverId=cover-1&size=300",
            },
          ],
          albums: [
            {
              id: "album-1",
              name: "Album",
              cover: "streaming-cover://image?serverId=server-1&coverId=album-cover&size=300",
            },
          ],
          artists: [],
          playlists: [],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          songs: [],
          albums: [],
          artists: [],
          playlists: [
            {
              id: "playlist-1",
              name: "Mix",
              cover: "streaming-cover://image?serverId=server-1&coverId=playlist-cover&size=300",
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { streamingClient } = await import("./streamingClient");
    const { serverAssetUrl } = await import("./controlAssets");
    const snapshot = await streamingClient.getSnapshot("server-1");
    const search = await streamingClient.search("server-1", "Mix");
    const webCover = snapshot.songs[0]?.cover;

    expect(webCover).toContain("/api/streaming/cover?serverId=server-1&coverId=cover-1&size=300");
    expect(snapshot.albums[0]?.cover).toContain("/api/streaming/cover?");
    expect(search.playlists[0]?.cover).toContain(
      "/api/streaming/cover?serverId=server-1&coverId=playlist-cover&size=300",
    );
    expect(serverAssetUrl(webCover)).toBe(
      "streaming-cover://image?serverId=server-1&coverId=cover-1&size=300",
    );
  });

  it("subscribes to Streaming library updates through the shared Core event envelope", async () => {
    let emit!: (data: { serverId: string }) => void;
    const subscribeCoreControlEvent = vi.fn((type: string, callback: typeof emit) => {
      expect(type).toBe("streamingLibraryUpdated");
      emit = callback;
      return () => {};
    });
    vi.doMock("./controlEventClient", () => ({ subscribeCoreControlEvent }));

    const { streamingClient } = await import("./streamingClient");
    const callback = vi.fn();
    streamingClient.onLibraryUpdated(callback);
    emit({ serverId: "server-1" });

    expect(subscribeCoreControlEvent).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("server-1");
    expect("getStreamUrl" in streamingClient).toBe(false);
  });
});
