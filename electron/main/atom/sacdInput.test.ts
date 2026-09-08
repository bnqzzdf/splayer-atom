import assert from "node:assert/strict";
import test from "node:test";
import { isSacdPlaybackInput, parseSacdPlaybackSource } from "./sacdInput";

test("SACD playback input resolves virtual track identity without treating the virtual path as a file", () => {
  assert.deepEqual(parseSacdPlaybackSource("/music/album.iso|Track04|656.080|157219|49206"), {
    isoPath: "/music/album.iso",
    trackNum: 4,
  });
  assert.deepEqual(parseSacdPlaybackSource("/music/album.iso", 6), {
    isoPath: "/music/album.iso",
    trackNum: 6,
  });
  assert.equal(parseSacdPlaybackSource("/music/album.flac", 1), null);
});

test("SACD generated input ownership is process-scoped", () => {
  assert.equal(isSacdPlaybackInput("/tmp/not-owned.dsf"), false);
});
