import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { ErrorCode } from "@shared/types/errors";

const mocks = vi.hoisted(() => ({ addScanDir: vi.fn(), removeScanDir: vi.fn() }));
vi.mock("@/core/libraryClient", () => ({ libraryClient: mocks }));
vi.mock("@/core/controlEventClient", () => ({ subscribeCoreControlEvent: vi.fn(() => () => {}) }));

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe("Library scan root acceptance", () => {
  it("leaves the local projection untouched when Core rejects a nested root", async () => {
    mocks.addScanDir.mockResolvedValue({ success: false, error: ErrorCode.SCAN_DIR_NESTED });
    const { useLibraryStore } = await import("./library");
    const library = useLibraryStore();
    library.scanDirs = ["/music"];
    const result = await library.addScanDir("/music/album");
    expect(result).toMatchObject({ success: false, error: ErrorCode.SCAN_DIR_NESTED });
    expect(library.scanDirs).toEqual(["/music"]);
    expect(mocks.removeScanDir).not.toHaveBeenCalled();
  });

  it("updates only after Core succeeds, even if the local projection is stale", async () => {
    mocks.addScanDir.mockResolvedValue({ success: true, data: "/music/album" });
    const { useLibraryStore } = await import("./library");
    const library = useLibraryStore();
    const result = await library.addScanDir("/music/album");
    expect(result.success).toBe(true);
    expect(library.scanDirs).toEqual(["/music/album"]);
    expect(mocks.removeScanDir).not.toHaveBeenCalled();
  });
});
