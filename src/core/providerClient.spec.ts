import { afterEach, describe, expect, it, vi } from "vitest";
import { isManagedProviderPlatform } from "@shared/types/apis";

const resetRuntime = (): void => {
  delete document.documentElement.dataset.atomRuntime;
  vi.unstubAllGlobals();
  vi.resetModules();
};

afterEach(resetRuntime);

describe("managed Provider Core Protocol client", () => {
  it("uses the Desktop Core scheme for managed provider calls", async () => {
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
        new Response(JSON.stringify({ ok: true, data: { id: "1" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { providerClient } = await import("./providerClient");
    await expect(
      providerClient.call("qobuz", "catalog_search", { query: "test" }),
    ).resolves.toEqual({
      ok: true,
      data: { id: "1" },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("atom-core://control/api/info");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("atom-core://control/api/providers/call");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        platform: "qobuz",
        name: "catalog_search",
        params: { query: "test" },
      }),
    });
  });

  it("uses the same Core routes for session refresh, clear and manual cookie", async () => {
    document.documentElement.dataset.atomRuntime = "desktop";
    const sessions = {
      netease: { authenticated: true },
      qobuz: { authenticated: false },
      tidal: { authenticated: false },
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
        new Response(JSON.stringify(sessions), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
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

    const { providerClient } = await import("./providerClient");
    await expect(providerClient.getSessions()).resolves.toEqual(sessions);
    await expect(providerClient.clearSession("tidal")).resolves.toBeUndefined();
    await expect(providerClient.setCookie("netease", "MUSIC_U=test")).resolves.toEqual({
      ok: true,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("atom-core://control/api/info");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("atom-core://control/api/providers/sessions");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("atom-core://control/api/providers/clear-session");
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ platform: "tidal" }),
    });
    expect(fetchMock.mock.calls[3]?.[0]).toBe("atom-core://control/api/providers/set-cookie");
  });

  it("keeps QQ Music and Kugou outside the managed Provider Core Domain", () => {
    expect(isManagedProviderPlatform("netease")).toBe(true);
    expect(isManagedProviderPlatform("qobuz")).toBe(true);
    expect(isManagedProviderPlatform("tidal")).toBe(true);
    expect(isManagedProviderPlatform("qqmusic")).toBe(false);
    expect(isManagedProviderPlatform("kugou")).toBe(false);
  });
});
