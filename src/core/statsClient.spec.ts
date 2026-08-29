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

describe("Stats Core Protocol client", () => {
  it("uses the Desktop Core scheme for stats queries", async () => {
    document.documentElement.dataset.atomRuntime = "desktop";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ protocol: { version: 1 } }))
      .mockResolvedValueOnce(
        jsonResponse({
          todayListenedMs: 1,
          weekListenedMs: 2,
          lastWeekListenedMs: 3,
          totalListenedMs: 4,
          weekPlayCount: 5,
          totalPlayCount: 6,
          weekFavoriteAdds: 7,
          streakDays: 8,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { statsClient } = await import("./statsClient");
    await expect(statsClient.getStatsSummary()).resolves.toMatchObject({ totalPlayCount: 6 });

    expect(fetchMock.mock.calls[1]?.[0]).toBe("atom-core://control/api/stats/summary");
  });

  it("projects Web artwork and canonicalizes favorite event tracks", async () => {
    document.documentElement.dataset.atomRuntime = "web";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ protocol: { version: 1 } }))
      .mockResolvedValueOnce(
        jsonResponse([
          {
            playCount: 3,
            track: {
              id: "track-1",
              title: "Track",
              source: "local",
              artists: [],
              duration: 1000,
              cover: "cache://covers/track.jpg",
            },
          },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const { statsClient } = await import("./statsClient");
    const top = await statsClient.getTopTracks(5);
    statsClient.recordFavorite({
      action: "add",
      track: {
        id: "track-1",
        title: "Track",
        source: "local",
        artists: [],
        duration: 1000,
        cover: "http://127.0.0.1:14558/cache/covers/favorite.jpg",
      },
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    expect(top[0]?.track.cover).toMatch(/\/cache\/covers\/track\.jpg$/);
    const favoriteBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)) as {
      track: { cover?: string };
    };
    expect(favoriteBody.track.cover).toBe("cache://covers/favorite.jpg");
  });
});
