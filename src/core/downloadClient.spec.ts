import { afterEach, describe, expect, it, vi } from "vitest";
import type { DownloadRequest, DownloadTask } from "@shared/types/download";

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

const request: DownloadRequest = {
  taskId: "task-1",
  track: {
    id: "remote:1",
    title: "Track",
    source: "netease",
    artists: [],
    duration: 1000,
    cover: "http://127.0.0.1:14558/cache/covers/a.jpg",
  },
  qualityLevel: "lossless",
  coverUrl: "http://127.0.0.1:14558/cache/covers/a.jpg",
  tagOptions: {
    embedCover: true,
    embedMeta: true,
    embedLyric: false,
    writeLrc: false,
    saveTtml: false,
  },
  usePlaybackForDownload: false,
  lyricFileFormat: "lrc",
};

const task: DownloadTask = {
  taskId: "task-1",
  status: "queued",
  track: {
    ...request.track,
    cover: "cache://covers/a.jpg",
  },
  qualityLevel: "lossless",
  received: 0,
  total: 0,
  createdAt: 1,
};

describe("Download Core Protocol client", () => {
  it("uses the Desktop Core scheme for queue and directory mutation", async () => {
    document.documentElement.dataset.atomRuntime = "desktop";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ protocol: { version: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ dir: "/music" }));
    vi.stubGlobal("fetch", fetchMock);

    const { downloadClient } = await import("./downloadClient");
    await expect(downloadClient.start(request)).resolves.toEqual({ ok: true });
    await expect(downloadClient.setDir("/music")).resolves.toBe("/music");

    expect(fetchMock.mock.calls[1]?.[0]).toBe("atom-core://control/api/download/start");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("atom-core://control/api/download/dir");
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ dir: "/music" }),
    });
  });

  it("canonicalizes Web request artwork and projects Core task artwork", async () => {
    document.documentElement.dataset.atomRuntime = "web";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ protocol: { version: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse([task]));
    vi.stubGlobal("fetch", fetchMock);

    const { downloadClient } = await import("./downloadClient");
    await downloadClient.start(request);
    const tasks = await downloadClient.list();

    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as DownloadRequest;
    expect(body.track.cover).toBe("cache://covers/a.jpg");
    expect(body.coverUrl).toBe("cache://covers/a.jpg");
    expect(tasks[0]?.track.cover).toMatch(/\/cache\/covers\/a\.jpg$/);
    expect(fetchMock.mock.calls[2]?.[0]).toMatch(/\/api\/download\/tasks$/);
  });
});
