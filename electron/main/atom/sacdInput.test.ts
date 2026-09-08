import assert from "node:assert/strict";
import test from "node:test";
import { parseSacdPlaybackSource, toNativeSacdPlaybackSource } from "./sacdInput";

test("SACD native source keeps virtual identity and normalizes legacy plain ISO without IO", () => {
  const virtual = "/music/album.iso|Track04|656.080|157219|49206";
  assert.deepEqual(parseSacdPlaybackSource(virtual), {
    isoPath: "/music/album.iso",
    trackNum: 4,
  });
  assert.equal(toNativeSacdPlaybackSource(virtual, 1, 1), virtual);
  assert.equal(
    toNativeSacdPlaybackSource("/music/album.iso", 6, 704720),
    "/music/album.iso|Track06|704.720|0|0",
  );
  assert.equal(toNativeSacdPlaybackSource("/music/album.flac", 1, 1000), null);
});
