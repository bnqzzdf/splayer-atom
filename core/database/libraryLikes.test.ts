import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("local library likes are Core-owned and legacy imports merge without replacing", async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "splayer-library-likes-"));
  const previousDataDir = process.env.ATOM_DATA_DIR;
  process.env.ATOM_DATA_DIR = dataDir;

  const database = await import("./index");
  const likes = await import("./libraryLikes");
  try {
    database.initDatabase();
    const insert = database.getDb().prepare(
      `INSERT INTO tracks (id, path, title, artists, duration, file_size, scanned_at)
       VALUES (?, ?, ?, '[]', 1, 1, 1)`,
    );
    insert.run("a", "/music/a.flac", "A");
    insert.run("b", "/music/b.flac", "B");

    likes.setLibraryTrackLiked("a", true);
    likes.importLibraryLikedTrackIds(["b", "missing"]);
    assert.deepEqual(new Set(likes.getLibraryLikedTrackIds()), new Set(["a", "b"]));

    likes.setLibraryTrackLiked("a", false);
    assert.deepEqual(likes.getLibraryLikedTrackIds(), ["b"]);
    assert.throws(() => likes.setLibraryTrackLiked("missing", true), /LIBRARY_TRACK_NOT_FOUND/);
  } finally {
    database.closeDatabase();
    if (previousDataDir === undefined) delete process.env.ATOM_DATA_DIR;
    else process.env.ATOM_DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
