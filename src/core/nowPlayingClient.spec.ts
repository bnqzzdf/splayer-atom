import { afterEach, describe, expect, it, vi } from "vitest";
import type { NowPlayingSnapshot } from "@shared/types/nowPlaying";

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
  it("uses Core HTTP routes for lyric offset query and command", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ protocol: { version: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ lyricOffsetMs: 750 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const { nowPlayingClient } = await import("./nowPlayingClient");
    await expect(nowPlayingClient.getLyricOffset()).resolves.toBe(750);
    nowPlayingClient.setLyricOffset("track-1", -500);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:14559/api/now-playing");
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "http://localhost:14559/api/now-playing/lyric-offset",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      trackId: "track-1",
      offsetMs: -500,
    });
  });

  it("rebuilds the Web full snapshot and projects artwork", async () => {
    const light = {
      track: {
        id: "track-1",
        title: "Track",
        source: "local",
        artists: [],
        duration: 1000,
        cover: "cache://covers/track.jpg",
      },
      position: 250,
      playing: true,
      state: "playing",
      speed: 1,
      lyricOffsetMs: 250,
      sendTimestamp: 1,
    } satisfies Omit<NowPlayingSnapshot, "lyric" | "source">;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ protocol: { version: 1 } }))
      .mockResolvedValueOnce(jsonResponse(light))
      .mockResolvedValueOnce(jsonResponse({ lyric: [], source: null }));
    vi.stubGlobal("fetch", fetchMock);

    const { nowPlayingClient } = await import("./nowPlayingClient");
    const snapshot = await nowPlayingClient.requestSnapshot();

    expect(snapshot.track?.cover).toMatch(/\/cache\/covers\/track\.jpg$/);
    expect(snapshot.lyricOffsetMs).toBe(250);
    expect(snapshot.lyric).toEqual([]);
    expect(snapshot.source).toBeNull();
  });

  it("queries the loaded current Track for projection reconciliation", async () => {
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
          position: 0,
          playing: true,
          state: "playing",
          speed: 1,
          lyricOffsetMs: 0,
          sendTimestamp: 1,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { nowPlayingClient } = await import("./nowPlayingClient");
    const track = await nowPlayingClient.getCurrentTrack();

    expect(track?.id).toBe("loaded-1");
    expect(track?.cover).toMatch(/\/cache\/covers\/loaded\.jpg$/);
    expect(String(fetchMock.mock.calls[1]?.[0])).toMatch(/\/api\/now-playing$/);
  });
});
