import { afterEach, describe, expect, it, vi } from "vitest";

const resetRuntime = (): void => {
  delete document.documentElement.dataset.atomRuntime;
  vi.unstubAllGlobals();
  vi.resetModules();
};

afterEach(resetRuntime);

describe("shared Core Protocol client", () => {
  it("uses the Electron-internal Core scheme for Desktop commands", async () => {
    document.documentElement.dataset.atomRuntime = "desktop";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ protocol: { version: 1 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { coreApiOrigin, coreCommand } = await import("./controlClient");
    expect(coreApiOrigin).toBe("atom-core://control");
    await expect(coreCommand("/seek", { positionMs: 1234 })).resolves.toEqual({ success: true });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("atom-core://control/api/info");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("atom-core://control/api/seek");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ positionMs: 1234 }),
    });
  });

  it("keeps Web Control on the existing HTTP origin", async () => {
    document.documentElement.dataset.atomRuntime = "web";
    const { coreApiOrigin } = await import("./controlClient");
    expect(coreApiOrigin).not.toBe("atom-core://control");
    expect(coreApiOrigin).toContain(window.location.hostname || "127.0.0.1");
  });
});
