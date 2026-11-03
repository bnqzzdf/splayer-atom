import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("physical-path lookups use indexes across ordinary, CUE and SACD tracks", async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "splayer-physical-paths-"));
  const previousDataDir = process.env.ATOM_DATA_DIR;
  process.env.ATOM_DATA_DIR = dataDir;
  const database = await import("./index");

  try {
    database.initDatabase();
    const db = database.getDb();
    const insert = db.prepare(`
      INSERT INTO tracks (
        id, path, cue_path, cue_audio_path, title, track, artists, duration,
        file_size, scanned_at
      ) VALUES (?, ?, ?, ?, ?, ?, '[]', 1, 1, 1)
    `);
    const ordinary = "/music/01.flac";
    const cue = "/music/album.cue";
    const backing = "/music/album.flac";
    const iso = "/music/100%_精选[1].ISO";
    const fixtures = [
      ["ordinary", ordinary, null, null, "Ordinary", 1],
      ["backing", backing, null, null, "Backing", null],
      ["cue2", `${cue}|Track02|1000|2000`, cue, backing, "CUE 2", 2],
      ["cue1", `${cue}|Track01|0|1000`, cue, backing, "CUE 1", 1],
      ["iso2", `${iso}|Track02|1000|2000`, null, null, "SACD 2", 2],
      ["iso1", `${iso}|Track01|0|1000`, null, null, "SACD 1", 1],
      ["sibling", "/music/100X_精选1.ISO|Track01|0|1000", null, null, "Sibling", 1],
      ["suffix", `${iso}.backup|Track01|0|1000`, null, null, "Backup", 1],
      ["upper", `${iso}|Tracl01|0|1000`, null, null, "Upper bound", 1],
      ["lower", `${iso}|Tracj01|0|1000`, null, null, "Lower bound", 1],
      ["not-iso", `${ordinary}|Track01|0|1000`, null, null, "Not ISO", 1],
    ];
    db.transaction(() => {
      for (const row of fixtures) insert.run(...row);
      for (let index = 0; index < 20_000; index++) {
        insert.run(`unrelated-${index}`, `/other/${index}.flac`, null, null, `Other ${index}`, 1);
      }
    })();

    assert.deepEqual(database.getTracksByPhysicalPaths([]), []);
    assert.deepEqual(
      database.getTracksByPhysicalPaths([ordinary]).map((track) => track.id),
      ["ordinary"],
    );
    assert.deepEqual(
      database.getTracksByPhysicalPaths([cue]).map((track) => track.id),
      ["cue1", "cue2"],
    );
    assert.deepEqual(
      database.getTracksByPhysicalPaths([backing]).map((track) => track.id),
      ["cue1", "cue2", "backing"],
    );
    assert.deepEqual(
      database.getTracksByPhysicalPaths([iso]).map((track) => track.id),
      ["iso1", "iso2"],
    );

    const requested = [ordinary, cue, backing, iso, "/music/missing.flac"];
    const prepare = db.prepare;
    let lookupSql = "";
    db.prepare = new Proxy(prepare, {
      apply(target, thisArg, args) {
        lookupSql = args[0];
        return Reflect.apply(target, thisArg, args);
      },
    });
    let tracks;
    try {
      tracks = database.getTracksByPhysicalPaths([...requested, cue, iso]);
    } finally {
      db.prepare = prepare;
    }
    assert.equal(tracks.length, 6);
    assert.equal(new Set(tracks.map((track) => track.id)).size, 6);
    const chunked = database.getTracksByPhysicalPaths([
      cue,
      ...Array.from({ length: 205 }, (_, index) => `/music/missing-${index}.flac`),
      backing,
      iso,
      ordinary,
    ]);
    assert.deepEqual(
      chunked.map((track) => track.id).sort(),
      tracks.map((track) => track.id).sort(),
    );

    db.exec("DROP INDEX idx_tracks_cue_path; DROP INDEX idx_tracks_cue_audio_path;");
    database.closeDatabase();
    database.initDatabase();
    assert.deepEqual(
      database.getTracksByPhysicalPaths([cue]).map((track) => track.id),
      ["cue1", "cue2"],
    );
    const plan = database
      .getDb()
      .prepare(`EXPLAIN QUERY PLAN ${lookupSql}`)
      .all(...requested) as { detail: string }[];
    assert.ok(plan.length > 0);
    assert.equal(
      plan.some((step) => /\bSCAN (?:t|tracks)\b/.test(step.detail)),
      false,
      JSON.stringify(plan),
    );
  } finally {
    database.closeDatabase();
    if (previousDataDir === undefined) delete process.env.ATOM_DATA_DIR;
    else process.env.ATOM_DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
