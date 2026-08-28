import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { playbackSourceCacheKey, shouldRetryPlaybackSource } from "./playbackSourcePolicy";

const base = { id: "42" };

describe("playbackSourceCacheKey", () => {
  it("keeps local tracks outside the song cache", () => {
    assert.equal(playbackSourceCacheKey({ ...base, source: "local" }, "lossless"), null);
  });

  it("uses server and original ids for streaming tracks", () => {
    assert.equal(
      playbackSourceCacheKey(
        { ...base, source: "streaming", serverId: "server-a", originalId: "remote-7" },
        "lossless",
      ),
      "s:server-a:remote-7:",
    );
  });

  it("includes Core quality policy for Atom-owned online providers", () => {
    for (const source of ["netease", "qobuz", "tidal"] as const) {
      assert.equal(playbackSourceCacheKey({ ...base, source }, "hi-res"), `o:${source}:42:hi-res`);
    }
  });

  it("preserves inherited QQ/Kugou cache-key compatibility without claiming Core resolution", () => {
    assert.equal(playbackSourceCacheKey({ ...base, source: "qqmusic" }, "hq"), "o:qqmusic:42:");
    assert.equal(playbackSourceCacheKey({ ...base, source: "kugou" }, "hq"), "o:kugou:42:");
  });
});

describe("shouldRetryPlaybackSource", () => {
  it("allows exactly one fresh resolve for non-local playback", () => {
    assert.equal(shouldRetryPlaybackSource({ source: "netease" }, 0), true);
    assert.equal(shouldRetryPlaybackSource({ source: "streaming" }, 0), true);
    assert.equal(shouldRetryPlaybackSource({ source: "qobuz" }, 1), false);
  });

  it("never retries local files through the provider resolver", () => {
    assert.equal(shouldRetryPlaybackSource({ source: "local" }, 0), false);
  });
});
