import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { CONFIG_SCHEMA_VERSION } from "../atom/runtime/configSchema";
import { inspectCoreDataSchema, prepareCoreDataMigration } from "../atom/runtime/dataMigration";
import { DATABASE_SCHEMA_VERSION, migrate } from "../database/migration";

const createTempRoot = (): string =>
  mkdtempSync(path.join(tmpdir(), "splayer-atom-data-migration-"));
const coreEntrySource = readFileSync(new URL("../core-node/index.ts", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("../store/index.ts", import.meta.url), "utf8");

const openDatabase = (root: string): Database.Database => {
  const dir = path.join(root, "database");
  mkdirSync(dir, { recursive: true });
  return new Database(path.join(dir, "library.db"));
};

test("Core runs migration preflight before loading store and database modules", () => {
  const preflightIndex = coreEntrySource.indexOf("prepareCoreDataMigration()");
  const storeImportIndex = coreEntrySource.indexOf('import("@main/store")');
  const databaseImportIndex = coreEntrySource.indexOf('import("@main/database")');
  assert.ok(preflightIndex >= 0);
  assert.ok(storeImportIndex > preflightIndex);
  assert.ok(databaseImportIndex > preflightIndex);
  assert.match(storeSource, /Config schema .* is newer than supported/);
  assert.match(storeSource, /CONFIG_SCHEMA_VERSION/);
});

test("Core migration preflight creates one recoverable DB/config snapshot only for old durable state", () => {
  const root = createTempRoot();
  const database = openDatabase(root);
  try {
    database.pragma("journal_mode = WAL");
    database.exec(
      "CREATE TABLE durable(value TEXT NOT NULL); INSERT INTO durable VALUES ('kept');",
    );
    database.pragma("user_version = 3");

    const configDir = path.join(root, "config");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(path.join(configDir, "settings.json"), JSON.stringify({ __configVersion: 0 }));
    writeFileSync(path.join(configDir, "qobuz.json"), JSON.stringify({ credential: "preserved" }));

    const now = new Date("2026-08-29T02:00:00.000Z");
    const backupDir = prepareCoreDataMigration({ dataRoot: root, now });
    assert.ok(backupDir);
    assert.equal(existsSync(path.join(backupDir, "library.db")), true);
    assert.equal(existsSync(path.join(backupDir, "config", "qobuz.json")), true);

    const backupDatabase = new Database(path.join(backupDir, "library.db"), { readonly: true });
    try {
      assert.deepEqual(backupDatabase.prepare("SELECT value FROM durable").get(), {
        value: "kept",
      });
      assert.equal(backupDatabase.pragma("user_version", { simple: true }), 3);
    } finally {
      backupDatabase.close();
    }

    const manifest = JSON.parse(readFileSync(path.join(backupDir, "manifest.json"), "utf8")) as {
      database: { from: number; to: number };
      config: { from: number; to: number };
    };
    assert.deepEqual(manifest.database, { from: 3, to: DATABASE_SCHEMA_VERSION });
    assert.deepEqual(manifest.config, { from: 0, to: CONFIG_SCHEMA_VERSION });
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Core migration preflight leaves a fresh installation without empty backups", () => {
  const root = createTempRoot();
  try {
    assert.equal(prepareCoreDataMigration({ dataRoot: root }), null);
    assert.equal(existsSync(path.join(root, "backups")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Core refuses future database or config schema before creating a migration backup", () => {
  const databaseRoot = createTempRoot();
  const database = openDatabase(databaseRoot);
  try {
    database.pragma(`user_version = ${DATABASE_SCHEMA_VERSION + 1}`);
    assert.throws(
      () => inspectCoreDataSchema(databaseRoot),
      /Database schema .* is newer than supported/,
    );
    assert.equal(existsSync(path.join(databaseRoot, "backups")), false);
  } finally {
    database.close();
    rmSync(databaseRoot, { recursive: true, force: true });
  }

  const configRoot = createTempRoot();
  try {
    const configDir = path.join(configRoot, "config");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      path.join(configDir, "settings.json"),
      JSON.stringify({ __configVersion: CONFIG_SCHEMA_VERSION + 1 }),
    );
    assert.throws(
      () => inspectCoreDataSchema(configRoot),
      /Config schema .* is newer than supported/,
    );
    assert.equal(existsSync(path.join(configRoot, "backups")), false);
  } finally {
    rmSync(configRoot, { recursive: true, force: true });
  }
});

test("SQLite known migration is transactional and rejects an unknown future schema", () => {
  const database = new Database(":memory:");
  try {
    database.exec(
      "CREATE TABLE tracks(id TEXT); CREATE TABLE lyric_match_cache(fingerprint TEXT);",
    );
    database.pragma("user_version = 3");
    migrate(database);
    assert.equal(database.pragma("user_version", { simple: true }), DATABASE_SCHEMA_VERSION);
    const trackColumns = database.prepare("PRAGMA table_info(tracks)").all() as { name: string }[];
    assert.equal(
      trackColumns.some((column) => column.name === "cue_path"),
      true,
    );
    const lyricColumns = database.prepare("PRAGMA table_info(lyric_match_cache)").all() as {
      name: string;
    }[];
    assert.equal(
      lyricColumns.some((column) => column.name === "extra"),
      true,
    );

    database.pragma(`user_version = ${DATABASE_SCHEMA_VERSION + 1}`);
    assert.throws(() => migrate(database), /is newer than supported/);
  } finally {
    database.close();
  }
});

test("DSD metadata migration invalidates only physical DSD fingerprints once", () => {
  const database = new Database(":memory:");
  try {
    database.exec(`
      CREATE TABLE tracks(path TEXT, file_mtime INTEGER, cue_path TEXT);
      CREATE TABLE lyric_match_cache(fingerprint TEXT, extra TEXT);
      INSERT INTO tracks(path, file_mtime, cue_path) VALUES
        ('/music/tagged.dsf', 101, NULL),
        ('/music/tagged.DFF', 102, NULL),
        ('/music/tagged.dsdiff', 103, NULL),
        ('/music/ordinary.flac', 104, NULL),
        ('/music/container.dsf|cue', 105, '/music/album.cue');
    `);
    database.pragma("user_version = 4");

    migrate(database);

    const rows = database
      .prepare("SELECT path, file_mtime AS mtime FROM tracks ORDER BY path")
      .all() as { path: string; mtime: number | null }[];
    const byPath = new Map(rows.map((row) => [row.path, row.mtime]));
    assert.equal(byPath.get("/music/tagged.dsf"), null);
    assert.equal(byPath.get("/music/tagged.DFF"), null);
    assert.equal(byPath.get("/music/tagged.dsdiff"), null);
    assert.equal(byPath.get("/music/ordinary.flac"), 104);
    assert.equal(byPath.get("/music/container.dsf|cue"), 105);
    assert.equal(database.pragma("user_version", { simple: true }), DATABASE_SCHEMA_VERSION);

    database.prepare("UPDATE tracks SET file_mtime = 201 WHERE path = '/music/tagged.dsf'").run();
    migrate(database);
    assert.equal(
      database
        .prepare("SELECT file_mtime FROM tracks WHERE path = '/music/tagged.dsf'")
        .pluck()
        .get(),
      201,
    );
  } finally {
    database.close();
  }
});

test("SQLite migration failure rolls back schema changes and user_version", () => {
  const database = new Database(":memory:");
  try {
    database.exec("CREATE TABLE tracks(id TEXT)");
    database.pragma("user_version = 3");
    assert.throws(() => migrate(database), /no such table: lyric_match_cache/);
    assert.equal(database.pragma("user_version", { simple: true }), 3);
    const columns = database.prepare("PRAGMA table_info(tracks)").all() as { name: string }[];
    assert.equal(
      columns.some((column) => column.name === "cue_path"),
      false,
    );
  } finally {
    database.close();
  }
});
