import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("library queries keep albums, track numbers, and CUE positions in stable order", async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "splayer-library-order-"));
  const previousDataDir = process.env.ATOM_DATA_DIR;
  process.env.ATOM_DATA_DIR = dataDir;

  const database = await import("./index");
  try {
    database.initDatabase();
    const insert = database.getDb().prepare(`
      INSERT INTO tracks (
        id, path, cue_start_ms, title, track, artists, album, duration,
        file_size, scanned_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const artist = JSON.stringify([{ id: 1, name: "Artist" }]);
    const rows = [
      ["b2", "/music/b-02.flac", null, "B 2", 2, artist, '{"name":"Album B"}', 1, 1, 1],
      ["b1b", "/music/b-01b.flac", 30_000, "B 1b", 1, artist, '{"name":"Album B"}', 1, 1, 1],
      ["a1", "/music/a-01.flac", null, "A 1", 1, artist, '{"name":"Album A"}', 1, 1, 1],
      ["b1a", "/music/b-01a.flac", 0, "B 1a", 1, artist, '{"name":"Album B"}', 1, 1, 1],
    ];
    for (const row of rows) insert.run(...row);

    assert.deepEqual(
      database.getAlbumTracks("Album B").map((track) => track.id),
      ["b1a", "b1b", "b2"],
    );
    assert.deepEqual(
      database.getArtistTracks("artist").map((track) => track.id),
      ["a1", "b1a", "b1b", "b2"],
    );
    assert.deepEqual(
      database.getAllTracks().map((track) => track.id),
      ["a1", "b1a", "b1b", "b2"],
    );

    database.upsertTracks([
      {
        id: "a1",
        path: "/music/a-01.flac",
        title: "A 1 updated",
        track: 1,
        artists: [{ name: "Artist" }],
        album: { name: "Album A", year: 1999 },
        duration: 1,
        fileSize: 1,
        mtime: 2,
        ctime: 1,
      },
    ]);
    const albumA = database.getAlbumList().find((album) => album.name === "Album A");
    assert.equal(albumA?.year, 1999);
    assert.equal(albumA?.addedAt, 1, "更新既有曲目时应保留首次入库时间");
  } finally {
    database.closeDatabase();
    if (previousDataDir === undefined) {
      delete process.env.ATOM_DATA_DIR;
    } else {
      process.env.ATOM_DATA_DIR = previousDataDir;
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
});
