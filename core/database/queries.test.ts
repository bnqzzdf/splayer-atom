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

    const sameTitleRows = [
      [
        "r1d1t1",
        "/music/recording-a/CD1/01.flac",
        null,
        "Recording A D1T1",
        1,
        artist,
        '{"name":"Same Album"}',
        1,
        1,
        2,
      ],
      [
        "r1d1t2",
        "/music/recording-a/CD1/02.flac",
        null,
        "Recording A D1T2",
        2,
        artist,
        '{"name":"Same Album"}',
        1,
        1,
        2,
      ],
      [
        "r1d2t1",
        "/music/recording-a/CD2/01.flac",
        null,
        "Recording A D2T1",
        1,
        artist,
        '{"name":"Same Album"}',
        1,
        1,
        2,
      ],
      [
        "r2t1",
        "/music/recording-b/01.flac",
        null,
        "Recording B T1",
        1,
        JSON.stringify([{ name: "Other Artist" }]),
        '{"name":"Same Album"}',
        1,
        1,
        3,
      ],
    ];
    for (const row of sameTitleRows) insert.run(...row);

    const sameAlbums = database.getAlbumList().filter((album) => album.name === "Same Album");
    assert.equal(sameAlbums.length, 2, "不同物理专辑目录中的同名专辑必须保持独立");
    assert.notEqual(sameAlbums[0]?.id, sameAlbums[1]?.id);
    const recordingA = sameAlbums.find(
      (album) => database.getAlbumTracks(album.id, album.name).length === 3,
    );
    assert.ok(recordingA);
    const recordingATracks = database.getAlbumTracks(recordingA.id, recordingA.name);
    assert.deepEqual(
      recordingATracks.map((track) => track.id),
      ["r1d1t1", "r1d1t2", "r1d2t1"],
      "缺少 DISC 标签时应按 CD1/CD2 目录再按 track 排序",
    );
    assert.deepEqual(
      recordingATracks.map((track) => track.disc),
      [1, 1, 2],
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

    database.upsertTracks([
      {
        id: "wild-percent",
        path: "/music/100% Hits/a.cue|Track01|0|1000",
        cuePath: "/music/100% Hits/a.cue",
        cueAudioPath: "/music/100% Hits/a.flac",
        title: "Percent",
        artists: [],
        duration: 1000,
        fileSize: 1,
        mtime: 1,
        ctime: 1,
      },
      {
        id: "wild-sibling",
        path: "/music/100X Hits/b.cue|Track01|0|1000",
        cuePath: "/music/100X Hits/b.cue",
        cueAudioPath: "/music/100X Hits/b.flac",
        title: "Sibling",
        artists: [],
        duration: 1000,
        fileSize: 1,
        mtime: 1,
        ctime: 1,
      },
    ]);
    assert.deepEqual(database.getCueTrackPathsByDirs(["/music/100% Hits"]), [
      "/music/100% Hits/a.cue|Track01|0|1000",
    ]);
    database.deleteTracksByDir("/music/100% Hits");
    assert.equal(
      database.getAllTracks().some((track) => track.id === "wild-percent"),
      false,
    );
    assert.equal(
      database.getAllTracks().some((track) => track.id === "wild-sibling"),
      true,
    );
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
