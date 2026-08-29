import { afterEach, describe, expect, it, vi } from "vitest";

const resetRuntime = (): void => {
  delete document.documentElement.dataset.atomRuntime;
  vi.unstubAllGlobals();
  vi.resetModules();
};

afterEach(resetRuntime);

describe("shared player processing Core Protocol client", () => {
  it("sends processing commands through the Desktop Core scheme", async () => {
    document.documentElement.dataset.atomRuntime = "desktop";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ protocol: { version: 1 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { playerClient } = await import("./playerClient");
    await expect(playerClient.setVolume(0.75)).resolves.toEqual({ success: true });
    await expect(playerClient.setPitchSync(true)).resolves.toEqual({ success: true });

    expect(fetchMock.mock.calls[1]?.[0]).toBe("atom-core://control/api/volume");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ volume: 0.75 }),
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe("atom-core://control/api/player/pitch-sync");
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ enabled: true }),
    });
  });

  it("reads the same Core status snapshot contract", async () => {
    document.documentElement.dataset.atomRuntime = "desktop";
    const status = {
      state: "playing",
      position: 1234,
      duration: 5678,
      volume: 0.5,
      speed: 1,
      isFinished: false,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ protocol: { version: 1 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(status), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { playerClient } = await import("./playerClient");
    await expect(playerClient.getStatus()).resolves.toEqual({ success: true, data: status });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("atom-core://control/api/status");
  });
});
