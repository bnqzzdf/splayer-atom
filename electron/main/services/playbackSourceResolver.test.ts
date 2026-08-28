import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { playbackSourceCacheKey } from "./playbackSourcePolicy";

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
