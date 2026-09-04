import assert from "node:assert/strict";
import test from "node:test";
import type { StreamingRuntimeConfig } from "@shared/types/streaming";
import { subsonicAdapter } from "./subsonic";

const config: StreamingRuntimeConfig = {
  id: "navidrome-home",
  name: "Navidrome",
  type: "navidrome",
  url: "https://music.example.test/",
  username: "listener",
  password: "secret",
  hasPassword: true,
};

const jsonResponse = (data: Record<string, unknown>, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("Subsonic binary stream and cover URLs omit JSON response format", async () => {
  const streamUrl = new URL(await subsonicAdapter.getStreamUrl(config, "song-1"));
  assert.equal(streamUrl.pathname, "/rest/stream");
  assert.equal(streamUrl.searchParams.get("id"), "song-1");
  assert.equal(streamUrl.searchParams.get("f"), null);
  assert.equal(streamUrl.searchParams.get("format"), null);
  assert.equal(streamUrl.searchParams.get("maxBitRate"), null);

  const coverUrl = new URL(await subsonicAdapter.getCoverUrl(config, "cover-1", 640));
  assert.equal(coverUrl.pathname, "/rest/getCoverArt");
  assert.equal(coverUrl.searchParams.get("id"), "cover-1");
  assert.equal(coverUrl.searchParams.get("size"), "640");
  assert.equal(coverUrl.searchParams.get("f"), null);
});

test("Subsonic song listing falls back to deterministic album pagination", async () => {
  const originalFetch = globalThis.fetch;
  const requestedEndpoints: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requestedEndpoints.push(url.pathname);
    if (url.pathname.endsWith("/search3")) {
      return jsonResponse({ "subsonic-response": { status: "ok", searchResult3: {} } });
    }
    if (url.pathname.endsWith("/getAlbumList2")) {
      return jsonResponse({
        "subsonic-response": {
          status: "ok",
          albumList2: {
            album: [
              { id: "album-1", name: "First", songCount: 1 },
              { id: "album-2", name: "Second", songCount: 1 },
            ],
          },
        },
      });
    }
    if (url.pathname.endsWith("/getAlbum") && url.searchParams.get("id") === "album-2") {
      return jsonResponse({
        "subsonic-response": {
          status: "ok",
          album: {
            id: "album-2",
            name: "Second",
            song: [{ id: "song-2", title: "Second Song", duration: 180 }],
          },
        },
      });
    }
    throw new Error(`unexpected request: ${url}`);
  };

  try {
    const tracks = await subsonicAdapter.listSongs(config, { offset: 1, limit: 1 });
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].id, "navidrome-home:song-2");
    assert.equal(tracks[0].originalId, "song-2");
    assert.deepEqual(requestedEndpoints, [
      "/rest/search3",
      "/rest/getAlbumList2",
      "/rest/getAlbum",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
