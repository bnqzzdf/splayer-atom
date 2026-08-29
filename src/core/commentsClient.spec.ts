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

describe("Comments Core Protocol client", () => {
  it("uses the Desktop Core scheme for source and page requests", async () => {
    document.documentElement.dataset.atomRuntime = "desktop";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ protocol: { version: 1 } }))
      .mockResolvedValueOnce(jsonResponse([{ id: "netease", name: "Netease", kind: "builtin" }]))
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, data: { list: [], total: 0, page: 1, limit: 20 } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { commentsClient } = await import("./commentsClient");
    await expect(commentsClient.sources()).resolves.toHaveLength(1);
    await expect(
      commentsClient.get({
        sourceId: "netease",
        track: { id: "1", title: "Track", source: "netease", artists: [], duration: 1000 },
        type: "hot",
        page: 1,
        limit: 20,
      }),
    ).resolves.toMatchObject({ ok: true });

    expect(fetchMock.mock.calls[1]?.[0]).toBe("atom-core://control/api/comments/sources");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("atom-core://control/api/comments/music");
  });

  it("canonicalizes Web cache artwork before sending a Track to Core", async () => {
    document.documentElement.dataset.atomRuntime = "web";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ protocol: { version: 1 } }))
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, data: { list: [], total: 0, page: 1, limit: 20 } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { commentsClient } = await import("./commentsClient");
    await commentsClient.get({
      sourceId: "netease",
      track: {
        id: "1",
        title: "Track",
        source: "netease",
        artists: [],
        duration: 1000,
        cover: "http://127.0.0.1:14558/cache/covers/track.jpg",
      },
      type: "new",
      page: 1,
      limit: 20,
    });

    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      track: { cover?: string };
    };
    expect(body.track.cover).toBe("cache://covers/track.jpg");
  });
});
