import { afterEach, describe, expect, it, vi } from "vitest";

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const resetRuntime = (): void => {
  vi.unstubAllGlobals();
  vi.resetModules();
};

afterEach(resetRuntime);

describe("NowPlaying Core Protocol client", () => {
  it("queries and writes lyric offset with an explicit lyric source", async () => {
    const source = {
      source: "online" as const,
      format: "lrc" as const,
      platform: "netease" as const,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ protocol: { version: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ offsetMs: 750 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const { nowPlayingClient } = await import("./nowPlayingClient");
    await expect(nowPlayingClient.getLyricOffset("track-1", source)).resolves.toBe(750);
    nowPlayingClient.setLyricOffset("track-1", source, -500);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://localhost:14559/api/now-playing/lyric-offset/query",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      trackId: "track-1",
      source,
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "http://localhost:14559/api/now-playing/lyric-offset",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      trackId: "track-1",
      source,
      offsetMs: -500,
    });
  });

  it("restores the loaded Track and TrackDetail without lyric presentation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ protocol: { version: 1 } }))
      .mockResolvedValueOnce(
        jsonResponse({
          track: {
            id: "loaded-1",
            title: "Loaded",
            source: "local",
            artists: [],
            duration: 1000,
            cover: "cache://covers/loaded.jpg",
          },
          detail: {
            quality: {
              sampleRate: 44100,
              channels: 2,
              bitsPerSample: 16,
              bitRate: 0,
              codec: "flac",
            },
            embeddedLyric: "[00:01.00]hello",
            externalLyrics: [],
          },
          position: 0,
          playing: true,
          state: "playing",
          speed: 1,
          sendTimestamp: 1,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { nowPlayingClient } = await import("./nowPlayingClient");
    const snapshot = await nowPlayingClient.getCurrentPlayback();

    expect(snapshot.track?.id).toBe("loaded-1");
    expect(snapshot.track?.cover).toMatch(/\/cache\/covers\/loaded\.jpg$/);
    expect(snapshot.detail?.embeddedLyric).toBe("[00:01.00]hello");
    expect(String(fetchMock.mock.calls[1]?.[0])).toMatch(/\/api\/now-playing$/);
  });
});
