import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tidalTrackToTrack } from "./tidal";

describe("tidalTrackToTrack", () => {
  it("maps TIDAL metadata into the canonical SPlayer Track", () => {
    const track = tidalTrackToTrack({
      id: 24680,
      title: "Example Track",
      version: "Remastered",
      duration: 241.25,
      artists: [
        { id: 12, name: "First Artist" },
        { id: "34", name: "Second Artist" },
      ],
      album: {
        id: 99,
        title: "Example Album",
        cover: "11111111-2222-3333-4444-555555555555",
      },
    });

    assert.equal(track.id, "24680");
    assert.equal(track.source, "tidal");
    assert.equal(track.title, "Example Track (Remastered)");
    assert.equal(track.duration, 241_250);
    assert.deepEqual(track.artists, [
      { id: "12", name: "First Artist" },
      { id: "34", name: "Second Artist" },
    ]);
    assert.equal(track.album?.id, "99");
    assert.equal(track.album?.name, "Example Album");
    assert.match(track.cover ?? "", /resources\.tidal\.com\/images/);
  });

  it("accepts a single string artist and clamps missing duration to zero", () => {
    const track = tidalTrackToTrack({
      id: "track-1",
      title: "Plain Track",
      artist: "Solo Artist",
      album: { title: "Album" },
    });

    assert.equal(track.duration, 0);
    assert.deepEqual(track.artists, [{ name: "Solo Artist" }]);
    assert.equal(track.cover, undefined);
  });
});
