import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlaylistDetail } from "@shared/types/playlist";

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

describe("Playlist Core Protocol client", () => {
  it("uses the Desktop Core scheme for CRUD and track mutation", async () => {
    document.documentElement.dataset.atomRuntime = "desktop";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ protocol: { version: 1 } }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "playlist-1",
          type: "local",
          title: "Playlist",
          trackCount: 0,
          createTime: 1,
          updateTime: 1,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ count: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    const { playlistClient } = await import("./playlistClient");
    await expect(
      playlistClient.create({ type: "local", title: "Playlist" }),
    ).resolves.toMatchObject({ id: "playlist-1" });
    await expect(playlistClient.addTracks("playlist-1", ["track-1"])).resolves.toBe(1);

    expect(fetchMock.mock.calls[1]?.[0]).toBe("atom-core://control/api/playlists");
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "atom-core://control/api/playlists/playlist-1/tracks",
    );
  });

  it("projects Web artwork and canonicalizes update and legacy cache URLs", async () => {
    document.documentElement.dataset.atomRuntime = "web";
    const detail: PlaylistDetail = {
      id: "playlist-1",
      type: "local",
      title: "Playlist",
      cover: "cache://covers/playlist.jpg",
      trackCount: 1,
      createTime: 1,
      updateTime: 1,
      tracks: [
        {
          id: "track-1",
          title: "Track",
          source: "local",
          artists: [],
          duration: 1000,
          cover: "cache://covers/track.jpg",
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ protocol: { version: 1 } }))
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(jsonResponse({ ...detail, tracks: undefined }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const { playlistClient } = await import("./playlistClient");
    const loaded = await playlistClient.get("playlist-1");
    await playlistClient.update("playlist-1", {
      cover: "http://127.0.0.1:14558/cache/covers/updated.jpg",
    });
    await playlistClient.importLegacy([
      {
        id: "legacy-1",
        title: "Legacy",
        cover: "http://127.0.0.1:14558/cache/covers/legacy.jpg",
        trackIds: [],
      },
    ]);

    expect(loaded?.cover).toMatch(/\/cache\/covers\/playlist\.jpg$/);
    expect(loaded?.tracks[0]?.cover).toMatch(/\/cache\/covers\/track\.jpg$/);
    const updateBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)) as {
      cover?: string;
    };
    expect(updateBody.cover).toBe("cache://covers/updated.jpg");
    const legacyBody = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body)) as Array<{
      cover?: string;
    }>;
    expect(legacyBody[0]?.cover).toBe("cache://covers/legacy.jpg");
  });
});
