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

describe("Library Core Protocol client", () => {
  it("uses the Desktop Core scheme and preserves cache URLs for Desktop", async () => {
    document.documentElement.dataset.atomRuntime = "desktop";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ protocol: { version: 1 } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: "local:1",
              title: "Track",
              source: "local",
              artists: [],
              duration: 1,
              cover: "cache://covers/a.jpg",
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { libraryClient } = await import("./libraryClient");
    const result = await libraryClient.getTracks();

    expect(result.success).toBe(true);
    expect(result.data?.[0]?.cover).toBe("cache://covers/a.jpg");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("atom-core://control/api/info");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("atom-core://control/api/library/tracks");
  });

  it("projects Core cache URLs to the Web Control origin", async () => {
    document.documentElement.dataset.atomRuntime = "web";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ protocol: { version: 1 } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ name: "Album", artist: "Artist", trackCount: 1, cover: "cache://covers/a.jpg" }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { libraryClient } = await import("./libraryClient");
    const result = await libraryClient.getAlbums();

    expect(result.success).toBe(true);
    expect(result.data?.[0]?.cover).toMatch(/\/cache\/covers\/a\.jpg$/);
    expect(fetchMock.mock.calls[1]?.[0]).toMatch(/\/api\/library\/albums$/);
  });

  it("uses the shared Core routes for scan roots, tags and file mutation", async () => {
    document.documentElement.dataset.atomRuntime = "desktop";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ protocol: { version: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: "/music" }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { title: "Track" } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: [] }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { deleted: 1, failed: 0 } }));
    vi.stubGlobal("fetch", fetchMock);

    const { libraryClient } = await import("./libraryClient");
    await expect(libraryClient.addScanDir("/music")).resolves.toMatchObject({ success: true });
    await expect(libraryClient.readTags("/music/a.flac")).resolves.toMatchObject({ success: true });
    await expect(libraryClient.writeTags([])).resolves.toMatchObject({ success: true });
    await expect(libraryClient.deleteTracks(["/music/a.flac"])).resolves.toMatchObject({
      success: true,
    });

    expect(fetchMock.mock.calls[1]?.[0]).toBe("atom-core://control/api/library/scan-dirs/add");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ dir: "/music" }),
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe("atom-core://control/api/library/tags/read");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("atom-core://control/api/library/tags/write");
    expect(fetchMock.mock.calls[4]?.[0]).toBe("atom-core://control/api/library/files");
  });
});
