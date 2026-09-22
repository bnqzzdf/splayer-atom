import { afterEach, describe, expect, it, vi } from "vitest";

const resetRuntime = (): void => {
  vi.unstubAllGlobals();
  vi.resetModules();
};

afterEach(resetRuntime);

describe("shared Core Protocol client", () => {
  it("uses the Core HTTP origin for commands", async () => {
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
    expect(coreApiOrigin).toBe("http://localhost:14559");
    await expect(coreCommand("/seek", { positionMs: 1234 })).resolves.toEqual({ success: true });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:14559/api/info");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:14559/api/seek");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ positionMs: 1234 }),
    });
  });

  it("uses the browser host for the Web Control origin", async () => {
    const { coreApiOrigin } = await import("./controlClient");
    expect(coreApiOrigin).toContain(window.location.hostname || "127.0.0.1");
  });
});
