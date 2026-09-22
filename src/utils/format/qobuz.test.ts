import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { qobuzTrackToTrack } from "./qobuz";

describe("qobuzTrackToTrack", () => {
  it("maps Qobuz metadata into the canonical SPlayer Track", () => {
    const track = qobuzTrackToTrack({
      id: 12345,
      title: "Example Song",
      version: "Live",
      duration: 215.5,
      performer: { id: 99, name: "Example Artist" },
      album: {
        id: "album-1",
        title: "Example Album",
        image: { large: "cover-large" },
        artist: { id: 99, name: "Example Artist" },
      },
    });

    assert.equal(track.id, "12345");
    assert.equal(track.source, "qobuz");
    assert.equal(track.title, "Example Song (Live)");
    assert.equal(track.duration, 215_500);
    assert.equal(track.cover, "cover-large");
    assert.deepEqual(track.artists, [{ id: "99", name: "Example Artist" }]);
    assert.equal(track.album?.id, "album-1");
    assert.equal(track.album?.name, "Example Album");
  });

  it("falls back to the album artist when performer is absent", () => {
    const track = qobuzTrackToTrack({
      id: "abc",
      title: "Plain Song",
      duration: 0,
      album: { title: "Album", artist: { name: "Album Artist" } },
    });

    assert.equal(track.duration, 0);
    assert.deepEqual(track.artists, [{ id: undefined, name: "Album Artist" }]);
    assert.equal(track.cover, undefined);
  });
});
