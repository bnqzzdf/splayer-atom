import { afterEach, describe, expect, it, vi } from "vitest";
import { filterWebSystemOutputs } from "./outputDevices";

const resetRuntime = (): void => {
  vi.unstubAllGlobals();
  vi.resetModules();
};

afterEach(resetRuntime);

describe("shared player processing Core Protocol client", () => {
  it("sends processing commands through Core HTTP routes", async () => {
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

    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:14559/api/volume");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ volume: 0.75 }),
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://localhost:14559/api/player/pitch-sync");
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ enabled: true }),
    });
  });

  it("keeps Web output presentation while using the shared Core snapshot", async () => {
    const devices = [
      { id: "alsa:default", name: "System Default", isDefault: true },
      { id: "alsa:plughw:CARD=USB,DEV=0", name: "USB DAC", isDefault: false },
      { id: "alsa:hw:CARD=USB,DEV=0", name: "USB DAC", isDefault: false },
      { id: "alsa:hw:CARD=Generic,DEV=3", name: "HD-Audio Generic, HDMI 0", isDefault: false },
      { id: "diretta:dx5", name: "DX5 II", isDefault: false },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ protocol: { version: 1 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ selected: devices[2].id, data: devices }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { playerClient } = await import("./playerClient");
    await expect(playerClient.getOutputSnapshot()).resolves.toEqual({
      success: true,
      data: {
        selected: devices[2].id,
        data: [devices[2], { ...devices[4], name: "DX5 II" }],
      },
    });
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/api/output/devices");
  });

  it("hides display-audio ALSA endpoints by default but preserves an explicit selection", () => {
    const devices = [
      { id: "alsa:hw:CARD=Generic,DEV=3", name: "HD-Audio Generic, HDMI 0", isDefault: false },
      {
        id: "alsa:hw:CARD=Generic_1,DEV=0",
        name: "HD-Audio Generic, ALC897 Analog",
        isDefault: false,
      },
      { id: "alsa:hw:CARD=FC4,DEV=0", name: "HiBy FC4, USB Audio", isDefault: false },
    ];

    expect(filterWebSystemOutputs(devices).map((device) => device.id)).toEqual([
      devices[1].id,
      devices[2].id,
    ]);
    expect(filterWebSystemOutputs(devices, devices[0].id).map((device) => device.id)).toEqual([
      devices[0].id,
      devices[1].id,
      devices[2].id,
    ]);
  });

  it("uses shared helper routes for cover and external lyric reads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ protocol: { version: 1 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: "data:image/jpeg;base64,abc" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: "[00:00.00]lyric" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { playerClient } = await import("./playerClient");
    await expect(playerClient.getCoverRaw()).resolves.toEqual({
      success: true,
      data: "data:image/jpeg;base64,abc",
    });
    await expect(playerClient.readLyricFile("/music/a.lrc")).resolves.toEqual({
      success: true,
      data: "[00:00.00]lyric",
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:14559/api/player/cover");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://localhost:14559/api/player/read-lyric");
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ path: "/music/a.lrc" }),
    });
  });

  it("reads the same Core status snapshot contract", async () => {
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
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:14559/api/status");
  });
});
