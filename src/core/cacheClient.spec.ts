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

describe("Cache Core Protocol client", () => {
  it("uses the Desktop Core scheme for cache management", async () => {
    document.documentElement.dataset.atomRuntime = "desktop";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ protocol: { version: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ dir: "/cache" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, dir: "/next-cache" }));
    vi.stubGlobal("fetch", fetchMock);

    const { cacheClient } = await import("./cacheClient");
    await expect(cacheClient.getDir()).resolves.toBe("/cache");
    await expect(cacheClient.setDir("/next-cache")).resolves.toEqual({
      ok: true,
      dir: "/next-cache",
    });

    expect(fetchMock.mock.calls[1]?.[0]).toBe("atom-core://control/api/cache/dir");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("atom-core://control/api/cache/dir");
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe("POST");
  });

  it("preserves Core not-empty refusal and clear commands", async () => {
    document.documentElement.dataset.atomRuntime = "desktop";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ protocol: { version: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ ok: false, dir: "/cache", reason: "notEmpty" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const { cacheClient } = await import("./cacheClient");
    await expect(cacheClient.setDir("/occupied")).resolves.toMatchObject({
      ok: false,
      reason: "notEmpty",
    });
    await cacheClient.clear("covers");
    await cacheClient.clearAllByKind("file");

    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ id: "covers" });
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({ kind: "file" });
  });
});
