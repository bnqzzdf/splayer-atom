import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("scoped scanner existing-data projection never includes records outside the subtree", async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "splayer-scanner-scope-"));
  const previousDataDir = process.env.ATOM_DATA_DIR;
  process.env.ATOM_DATA_DIR = dataDir;

  const database = await import("@main/database");
  const scanner = await import("./scanner");
  const root = "/music";
  const scope = path.join(root, "A");
  const sibling = path.join(root, "B");

  try {
    database.initDatabase();
    database.upsertTracks([
      {
        id: "a-track",
        path: path.join(scope, "track.flac"),
        title: "A",
        artists: [],
        duration: 1000,
        fileSize: 10,
        mtime: 100,
        ctime: 90,
      },
      {
        id: "b-track",
        path: path.join(sibling, "track.flac"),
        title: "B",
        artists: [],
        duration: 1000,
        fileSize: 20,
        mtime: 200,
        ctime: 190,
      },
      {
        id: "a-sacd",
        path: `${path.join(scope, "disc.iso")}|Track01|0|1000`,
        title: "Track 01",
        artists: [],
        duration: 1000,
        fileSize: 30,
        mtime: 300,
        ctime: 290,
      },
      {
        id: "b-sacd",
        path: `${path.join(sibling, "disc.iso")}|Track01|0|1000`,
        title: "Track 01",
        artists: [],
        duration: 1000,
        fileSize: 40,
        mtime: 400,
        ctime: 390,
      },
    ]);

    const insert = database.getDb().prepare(`
      INSERT INTO tracks (id, path, title, artists, duration, file_size, scanned_at)
      VALUES (?, ?, 'Other', '[]', 1, 1, 1)
    `);
    database.getDb().transaction(() => {
      for (let index = 0; index < 20_000; index++) {
        insert.run(`other-${index}`, `/other/${index}.flac`);
      }
    })();
    const db = database.getDb();
    const prepare = db.prepare;
    const statements: string[] = [];
    db.prepare = new Proxy(prepare, {
      apply(target, thisArg, args) {
        statements.push(args[0]);
        return Reflect.apply(target, thisArg, args);
      },
    });

    const projected = scanner.buildScanExistingData([scope]);
    db.prepare = prepare;
    assert.equal(statements.length, 1);
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN ${statements[0]}`)
      .all(scope + "/", scope + "0") as { detail: string }[];
    assert.ok(
      plan.some((step) => /path>\? AND path<\?/.test(step.detail)),
      JSON.stringify(plan),
    );
    assert.deepEqual(database.getFileRecords([]), []);
    assert.equal(database.getFileRecords([scope, sibling]).length, 4);
    assert.equal(database.getFileRecords(["/music/A sibling"]).length, 0);
    assert.deepEqual(
      projected.map((item) => item.path).sort(),
      [path.join(scope, "disc.iso"), path.join(scope, "track.flac")].sort(),
    );
    assert.equal(
      projected.some((item) => item.path.startsWith(sibling)),
      false,
      "records outside the requested subtree must never reach native deletion detection",
    );
    assert.equal(
      projected.find((item) => item.path.endsWith("disc.iso"))?.forceProbe,
      true,
      "legacy placeholder SACD metadata keeps its one-time refresh behavior inside scope",
    );
  } finally {
    database.closeDatabase();
    if (previousDataDir === undefined) delete process.env.ATOM_DATA_DIR;
    else process.env.ATOM_DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
