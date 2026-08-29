import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreControlEvent } from "@shared/types/coreEvents";

const resetRuntime = (): void => {
  delete document.documentElement.dataset.atomRuntime;
  Object.defineProperty(window, "api", { configurable: true, value: undefined });
  vi.unstubAllGlobals();
  vi.resetModules();
};

afterEach(resetRuntime);

describe("Core Control event client", () => {
  it("shares one Desktop core:event subscription across typed consumers", async () => {
    document.documentElement.dataset.atomRuntime = "desktop";
    let emit!: (event: CoreControlEvent) => void;
    const unsubscribe = vi.fn();
    const onEvent = vi.fn((callback: (event: CoreControlEvent) => void) => {
      emit = callback;
      return unsubscribe;
    });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { coreEvents: { onEvent } },
    });

    const { subscribeCoreControlEvent, subscribeCorePlayerProjection } =
      await import("./controlEventClient");
    const provider = vi.fn();
    const progress = vi.fn();
    const playerProjection = vi.fn();
    const offProvider = subscribeCoreControlEvent("providerSessions", provider);
    const offProgress = subscribeCoreControlEvent("downloadProgress", progress);
    const offPlayer = subscribeCorePlayerProjection(playerProjection);

    expect(onEvent).toHaveBeenCalledTimes(1);
    emit({
      type: "providerSessions",
      data: {
        netease: { authenticated: true },
        qobuz: { authenticated: false },
        tidal: { authenticated: false },
      },
    });
    emit({ type: "downloadProgress", data: { taskId: "task-1", received: 10, total: 100 } });
    emit({
      type: "status",
      data: {
        state: "paused",
        position: 1000,
        duration: 2000,
        volume: 1,
        speed: 1,
        isFinished: false,
      },
    });
    emit({ type: "position", data: { position: 1200, duration: 2000 } });
    emit({ type: "fftData", data: { ldata: [0.1], rdata: [0.2] } });

    expect(provider).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith({ taskId: "task-1", received: 10, total: 100 });
    expect(playerProjection).toHaveBeenCalledWith(expect.objectContaining({ type: "status" }));
    expect(playerProjection).toHaveBeenCalledWith(expect.objectContaining({ type: "position" }));
    expect(playerProjection).toHaveBeenCalledWith(expect.objectContaining({ type: "fftData" }));

    offProvider();
    offProgress();
    expect(unsubscribe).not.toHaveBeenCalled();
    offPlayer();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
