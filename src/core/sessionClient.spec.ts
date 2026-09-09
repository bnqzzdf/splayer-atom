import { afterEach, describe, expect, it, vi } from "vitest";

const resetRuntime = (): void => {
  vi.unstubAllGlobals();
  vi.resetModules();
};

afterEach(resetRuntime);

describe("shared playback session Core Protocol client", () => {
  it("preserves remove-index loadCurrent semantics over Core HTTP", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ protocol: { version: 1 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ queue: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { sessionClient } = await import("./sessionClient");
    await expect(sessionClient.removeSessionQueueIndex(4, false)).resolves.toMatchObject({
      success: true,
      data: { queue: [] },
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://localhost:14559/api/session/queue/4?loadCurrent=0",
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("sends the one-time legacy queue migration through Core Protocol", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ protocol: { version: 1 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ queue: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { sessionClient } = await import("./sessionClient");
    const items = [
      { track: { id: "legacy", title: "Legacy", source: "local", path: "/music/a.flac" } },
    ];
    await sessionClient.migrateLegacySessionQueue(items as never, null, 0, "list", "off");

    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:14559/api/session/migrate-legacy");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        items,
        originalItems: null,
        index: 0,
        repeat: "list",
        shuffle: "off",
      }),
    });
  });
});
