import { afterEach, describe, expect, it, vi } from "vitest";

const resetRuntime = (): void => {
  vi.unstubAllGlobals();
  vi.resetModules();
};

afterEach(resetRuntime);

describe("Core Control event client", () => {
  it("shares one WebSocket transport across typed consumers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ protocol: { version: 1 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    class MockWebSocket {
      static OPEN = 1;
      static instances: MockWebSocket[] = [];
      readyState = MockWebSocket.OPEN;
      onopen: (() => void) | null = null;
      onmessage: ((message: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      readonly send = vi.fn();
      readonly close = vi.fn();

      constructor(readonly url: string) {
        MockWebSocket.instances.push(this);
      }
    }
    vi.stubGlobal("WebSocket", MockWebSocket);

    const { subscribeCoreControlEvent, subscribeCorePlayerProjection } =
      await import("./controlEventClient");
    const provider = vi.fn();
    const progress = vi.fn();
    const playerProjection = vi.fn();
    const offProvider = subscribeCoreControlEvent("providerSessions", provider);
    const offProgress = subscribeCoreControlEvent("downloadProgress", progress);
    const offPlayer = subscribeCorePlayerProjection(playerProjection);

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0];
    expect(ws?.url).toBe("ws://localhost:14559/ws");
    const emit = (type: string, data: unknown): void => {
      ws?.onmessage?.({ data: JSON.stringify({ kind: "event", type, data }) });
    };

    emit("providerSessions", {
      netease: { authenticated: true },
      qobuz: { authenticated: false },
      tidal: { authenticated: false },
    });
    emit("downloadProgress", { taskId: "task-1", received: 10, total: 100 });
    emit("status", {
      state: "paused",
      position: 1000,
      duration: 2000,
      volume: 1,
      speed: 1,
      isFinished: false,
    });
    emit("position", { position: 1200, duration: 2000 });

    expect(provider).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith({ taskId: "task-1", received: 10, total: 100 });
    expect(playerProjection).toHaveBeenCalledWith(expect.objectContaining({ type: "status" }));
    expect(playerProjection).toHaveBeenCalledWith(expect.objectContaining({ type: "position" }));

    offProvider();
    offProgress();
    expect(ws?.close).not.toHaveBeenCalled();
    offPlayer();
    expect(ws?.close).toHaveBeenCalledTimes(1);
  });
});
