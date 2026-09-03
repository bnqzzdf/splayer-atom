import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { albumToCover, tidalTrackToTrack } from "./tidal";

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
    assert.match(decodeURIComponent(track.cover ?? ""), /resources\.tidal\.com\/images/);
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

  it("maps TIDAL search album artwork and artists[] through the Core image proxy", () => {
    const album = albumToCover({
      id: 23324600,
      title: "Greatest Hits (Deluxe)",
      cover: "b7168034-1b47-4d3b-ac36-eb478ab30373",
      artists: [{ id: 1736, name: "Dido" }],
      numberOfTracks: 31,
    });

    assert.equal(album.subtitle, "Dido");
    assert.equal(album.trackCount, 31);
    assert.match(album.cover ?? "", /\/api\/proxy\/image\?url=/);
    assert.match(decodeURIComponent(album.cover ?? ""), /resources\.tidal\.com\/images/);
  });
});
