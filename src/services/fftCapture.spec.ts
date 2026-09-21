import { nextTick, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { setFftEnabled } = vi.hoisted(() => ({ setFftEnabled: vi.fn() }));
const output = reactive({ fftAvailable: true });

vi.mock("@/core/playerClient", () => ({
  playerClient: { setFftEnabled },
}));
vi.mock("@/stores/status", () => ({
  useStatusStore: () => ({ output }),
}));

describe("fftCapture", () => {
  beforeEach(() => {
    vi.resetModules();
    setFftEnabled.mockReset();
    output.fftAvailable = true;
  });

  it("首个消费者开启 FFT，最后一个消费者释放时关闭", async () => {
    const { acquireFft, releaseFft } = await import("./fftCapture");

    acquireFft();
    acquireFft();
    releaseFft();

    expect(setFftEnabled).toHaveBeenCalledTimes(1);
    expect(setFftEnabled).toHaveBeenLastCalledWith(true);

    releaseFft();

    expect(setFftEnabled).toHaveBeenCalledTimes(2);
    expect(setFftEnabled).toHaveBeenLastCalledWith(false);
  });

  it("没有消费者时重复释放不会产生 Core command", async () => {
    const { releaseFft } = await import("./fftCapture");

    releaseFft();

    expect(setFftEnabled).not.toHaveBeenCalled();
  });

  it("只有 Core runtime 支持 FFT 时才开启，并随能力变化自动切换", async () => {
    output.fftAvailable = false;
    const { acquireFft, releaseFft } = await import("./fftCapture");

    acquireFft();
    expect(setFftEnabled).not.toHaveBeenCalled();

    output.fftAvailable = true;
    await nextTick();
    expect(setFftEnabled).toHaveBeenLastCalledWith(true);

    output.fftAvailable = false;
    await nextTick();
    expect(setFftEnabled).toHaveBeenLastCalledWith(false);

    releaseFft();
    expect(setFftEnabled).toHaveBeenCalledTimes(2);
  });
});
