import { afterEach, describe, expect, it, vi } from "vitest";

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Folder Browser Core Protocol client", () => {
  it("keeps current-folder filter in browse query instead of using recursive search", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ protocol: { version: 1 } }))
      .mockResolvedValueOnce(
        jsonResponse({
          path: "/music",
          root: "/music",
          parent: null,
          unavailable: false,
          counts: { directories: 0, media: 0, materials: 0, total: 0 },
          entries: [],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { folderBrowserClient } = await import("./folderBrowserClient");
    await folderBrowserClient.browse("/music", undefined, 200, undefined, "philip");

    const url = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(url.pathname).toBe("/api/library/folders/browse");
    expect(url.searchParams.get("path")).toBe("/music");
    expect(url.searchParams.get("filter")).toBe("philip");
    expect(url.pathname).not.toContain("/search");
  });

  it("uses the narrow Core route for one CUE/SACD split playlist mutation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ protocol: { version: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ count: 1, failed: [], added: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    const { folderBrowserClient } = await import("./folderBrowserClient");
    await expect(
      folderBrowserClient.addContainerTrackToPlaylist(
        "playlist-1",
        "/music/album.cue",
        "cue-track-2",
      ),
    ).resolves.toEqual({ count: 1, failed: [], added: 1 });

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://localhost:14559/api/library/folders/playlist-track",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      playlistId: "playlist-1",
      containerPath: "/music/album.cue",
      trackId: "cue-track-2",
    });
  });
});
