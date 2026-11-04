import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { hasNestedScanRoots, scanRootsOverlap } from "@main/services/scanRootValidation";

test("Linux scan roots use path segments, including the filesystem root", () => {
  assert.equal(scanRootsOverlap("/music", "/music/album"), true);
  assert.equal(scanRootsOverlap("/music/album", "/music"), true);
  assert.equal(scanRootsOverlap("/music", "/music-extra"), false);
  assert.equal(scanRootsOverlap("/", "/music"), true);
  assert.equal(scanRootsOverlap("/music", "/music"), true);
  assert.equal(hasNestedScanRoots(["/music", "/music-extra"]), false);
  assert.equal(hasNestedScanRoots(["/music/album", "/music"]), true);
});

test("Core rejects nested scan roots before writing, without touching tracks or playlists", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "splayer-scan-root-"));
  const previousDataDir = process.env.ATOM_DATA_DIR;
  process.env.ATOM_DATA_DIR = path.join(temp, "data");
  const music = path.join(temp, "music");
  const album = path.join(music, "album");
  const sibling = path.join(temp, "sibling");
  const prefixSibling = path.join(temp, "music-extra");
  const alias = path.join(temp, "alias");
  mkdirSync(album, { recursive: true });
  mkdirSync(sibling);
  mkdirSync(prefixSibling);
  symlinkSync(music, alias, "dir");

  const database = await import("@main/database");
  const playlists = await import("@main/database/playlists");
  const { store } = await import("@main/store");
  const { buildAtomCompatRoutes } = await import("./routes");

  const api = buildAtomCompatRoutes();
  const post = async (url: string, body: object) => {
    const response = await api.request(`http://test.local${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  try {
    database.initDatabase();
    const trackId = "kept-track";
    database
      .getDb()
      .prepare(
        `INSERT INTO tracks (id, path, title, artists, duration, file_size, scanned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(trackId, path.join(album, "piece.flac"), "Piece", "[]", 1000, 123, Date.now());
    const playlist = playlists.createPlaylist({ type: "local", title: "Keep associations" });
    playlists.addPlaylistTracks(playlist.id, [trackId]);
    const before = () => ({
      tracks: database.getTrackCount(),
      playlistIds: playlists.getPlaylist(playlist.id)?.tracks.map((track) => track.id),
    });
    const original = before();

    const added = await post("/library/scan-dirs/add", { dir: music });
    assert.equal(added.status, 200);
    assert.deepEqual(store.get("library.scanDirs"), [music]);

    for (const dir of [album, path.join(album, ".."), alias]) {
      const result = await post("/library/scan-dirs/add", { dir });
      assert.equal(result.status, 409);
      assert.equal(result.body.error, dir === album ? "SCAN_DIR_NESTED" : "SCAN_DIR_EXISTS");
      assert.deepEqual(store.get("library.scanDirs"), [music]);
      assert.deepEqual(before(), original);
    }

    const siblingAdd = await post("/library/scan-dirs/add", { dir: sibling });
    assert.equal(siblingAdd.status, 200);
    const prefixAdd = await post("/library/scan-dirs/add", { dir: prefixSibling });
    assert.equal(prefixAdd.status, 200);
    assert.deepEqual(store.get("library.scanDirs"), [music, sibling, prefixSibling]);

    const previousRoots = store.get("library.scanDirs");
    for (const dirs of [
      [album, music],
      [music, album],
      ["/", music],
    ]) {
      const result = await post("/library/scan-dirs", { dirs });
      assert.equal(result.status, 409);
      assert.equal(result.body.error, "SCAN_DIR_NESTED");
      assert.deepEqual(store.get("library.scanDirs"), previousRoots);
      assert.deepEqual(before(), original);
    }

    const duplicateAlias = await post("/library/scan-dirs", { dirs: [music, alias] });
    assert.equal(duplicateAlias.status, 200);
    assert.deepEqual(store.get("library.scanDirs"), [music]);
    assert.deepEqual(before(), original);

    const batch = await post("/library/scan-dirs", { dirs: [album, sibling, album] });
    assert.equal(batch.status, 200);
    assert.deepEqual(store.get("library.scanDirs"), [album, sibling]);
    assert.deepEqual(before(), original);

    // Control 可能还持有旧投影：Core 必须独立识别反向嵌套。
    const staleControl = await post("/library/scan-dirs/add", { dir: music });
    assert.equal(staleControl.status, 409);
    assert.equal(staleControl.body.error, "SCAN_DIR_NESTED");
    assert.deepEqual(before(), original);
  } finally {
    database.closeDatabase();
    if (previousDataDir === undefined) delete process.env.ATOM_DATA_DIR;
    else process.env.ATOM_DATA_DIR = previousDataDir;
    rmSync(temp, { recursive: true, force: true });
  }
});
