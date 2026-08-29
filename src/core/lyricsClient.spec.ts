import { afterEach, describe, expect, it, vi } from "vitest";

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const resetRuntime = (): void => {
  delete document.documentElement.dataset.atomRuntime;
  vi.unstubAllGlobals();
  vi.resetModules();
};

afterEach(resetRuntime);

describe("Lyrics Core Protocol client", () => {
  it("uses the Desktop Core scheme for matching and TTML requests", async () => {
    document.documentElement.dataset.atomRuntime = "desktop";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ protocol: { version: 1 } }))
      .mockResolvedValue(jsonResponse({ ok: true, data: null }));
    vi.stubGlobal("fetch", fetchMock);

    const { lyricsClient } = await import("./lyricsClient");
    await lyricsClient.matchById("netease", "1");
    await lyricsClient.matchByQuery("netease", {
      id: "1",
      title: "Track",
      source: "netease",
      artists: [],
      duration: 1000,
    });
    await lyricsClient.fetchTTMLOverlay(
      { id: "1", title: "Track", source: "netease", artists: [], duration: 1000 },
      "netease",
    );
    await lyricsClient.matchLocalTTML({
      id: "1",
      title: "Track",
      source: "local",
      artists: [],
      duration: 1000,
    });

    expect(fetchMock.mock.calls.slice(1).map((call) => call[0])).toEqual([
      "atom-core://control/api/lyrics/match-by-id",
      "atom-core://control/api/lyrics/match-by-query",
      "atom-core://control/api/lyrics/ttml-overlay",
      "atom-core://control/api/lyrics/local",
    ]);
  });

  it("canonicalizes Web cache artwork before Track-based lyric requests", async () => {
    document.documentElement.dataset.atomRuntime = "web";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ protocol: { version: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: null }));
    vi.stubGlobal("fetch", fetchMock);

    const { lyricsClient } = await import("./lyricsClient");
    await lyricsClient.matchByQuery("netease", {
      id: "1",
      title: "Track",
      source: "netease",
      artists: [],
      duration: 1000,
      cover: "http://127.0.0.1:14558/cache/covers/track.jpg",
    });

    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      track: { cover?: string };
    };
    expect(body.track.cover).toBe("cache://covers/track.jpg");
  });
});
