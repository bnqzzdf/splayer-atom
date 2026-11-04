import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WSContext } from "hono/ws";
import type { JsScanEvent, JsScannedTrack, FileRecord } from "@splayer/audio-engine";
import type { ScanProgress } from "@shared/types/library";

test("scoped scan lifecycle keeps CUE/SACD cleanup local and reports actual changes", async (t) => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "splayer-scan-lifecycle-"));
  const previousDataDir = process.env.ATOM_DATA_DIR;
  process.env.ATOM_DATA_DIR = dataDir;
  const scope = path.join(dataDir, "100%_精选");
  const sibling = scope + " sibling";
  mkdirSync(scope);
  mkdirSync(sibling);
  let callback!: (event: JsScanEvent) => void;
  let existing: FileRecord[] = [];
  let sacdTracks: JsScannedTrack[] = [];
  const engineKey = Symbol.for("splayer.scan-lifecycle-engine");
  Reflect.set(globalThis, engineKey, {
    scanDirs(_dirs: string[], listener: typeof callback, _cache: string, records: FileRecord[]) {
      callback = listener;
      existing = records;
    },
    probeSacdTracks: async () => sacdTracks,
    cancelScan() {},
  });
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "./engine" && context.parentURL?.endsWith("/services/scanner.ts")) {
        return {
          url: 'data:text/javascript,export const getEngine=()=>globalThis[Symbol.for("splayer.scan-lifecycle-engine")]',
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });
  const database = await import("@main/database");
  const scanner = await import("./scanner");
  const { getLibraryRevision } = await import("./libraryRevision");
  const { addWsClient, removeWsClient } = await import("@main/server/broadcast");
  let resolveDone: ((progress: ScanProgress) => void) | null = null;
  const ws = new WSContext({
    readyState: 1,
    close() {},
    send(payload) {
      const event = JSON.parse(String(payload));
      if (event.type === "libraryScanProgress" && event.data.phase === "done") {
        resolveDone?.(event.data);
        resolveDone = null;
      }
    },
  });
  addWsClient(ws);
  const physical = path.join(scope, "whole.flac");
  const cue = path.join(scope, "album.cue");
  const iso = path.join(scope, "disc.iso");
  const cueSibling = path.join(sibling, "album.cue");
  const makeTrack = (id: string, filePath: string) => ({
    id,
    path: filePath,
    title: id,
    artists: [],
    duration: 2000,
    fileSize: 1,
    mtime: 1,
    ctime: 1,
  });
  const finish = async (event: Partial<JsScanEvent> = {}) => {
    const progress = await new Promise<ScanProgress>((resolve) => {
      resolveDone = resolve;
      callback({ eventType: "done", total: 0, scanned: 0, ...event });
    });
    assert.equal(scanner.isScanning(), false);
    assert.deepEqual(scanner.getScanProgress(), progress);
    return progress;
  };

  try {
    database.initDatabase();
    database.upsertTracks([
      makeTrack("audio", physical),
      { ...makeTrack("sibling-cue", `${cueSibling}|Track01|0|2000`), cuePath: cueSibling },
    ]);
    await t.test(
      "unchanged ordinary scan avoids library revisions and unrelated records",
      async () => {
        const revision = getLibraryRevision();
        assert.equal(scanner.startScan([scope]), true);
        assert.deepEqual(
          existing.map((record) => record.path),
          [physical],
        );
        assert.equal((await finish()).changed, false);
        assert.equal(getLibraryRevision(), revision);
      },
    );
    await t.test(
      "CUE sync resolves only its backing audio and preserves unchanged splits",
      async () => {
        writeFileSync(cue, 'FILE "whole.flac" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00\n');
        scanner.startScan([scope]);
        assert.equal((await finish({ cueFiles: [cue] })).changed, true);
        const tracks = database.getCueTracksByDirs([scope]);
        assert.equal(tracks.length, 1);
        assert.equal(tracks[0].cueAudioPath, physical);
        assert.equal(tracks[0].cueStartFrame75, 0);
        assert.equal(tracks[0].mtime, statSync(cue).mtimeMs);
        const revision = getLibraryRevision();
        scanner.startScan([scope]);
        assert.equal((await finish({ cueFiles: [cue] })).changed, false);
        assert.equal(getLibraryRevision(), revision);
      },
    );
    await t.test("unavailable CUE scope preserves existing splits", async () => {
      scanner.startScan([scope]);
      assert.equal((await finish({ unavailableDirs: [scope] })).changed, false);
      assert.equal(database.getCueTracksByDirs([scope]).length, 1);
    });
    await t.test("missing CUE is cleaned up while sibling scope remains intact", async () => {
      rmSync(cue);
      scanner.startScan([scope]);
      assert.equal((await finish()).changed, true);
      assert.deepEqual(database.getCueTracksByDirs([scope]), []);
      assert.equal(database.getCueTracksByDirs([sibling]).length, 1);
      assert.equal(database.getTracksByPhysicalPaths([physical]).length, 1);
    });
    await t.test("new native tracks mark the scan changed", async () => {
      scanner.startScan([scope]);
      callback({
        eventType: "progress",
        total: 1,
        scanned: 1,
        tracks: [
          {
            path: physical,
            title: "Updated",
            duration: 2,
            codec: "flac",
            sampleRate: 44100,
            channels: 2,
            bitRate: 1000,
            bitsPerSample: 16,
            fileSize: 1,
            mtime: 2,
            ctime: 1,
          },
        ],
      });
      assert.equal((await finish({ total: 1, scanned: 1 })).changed, true);
      assert.equal(database.getTracksByPhysicalPaths([physical])[0].title, "Updated");
    });
    await t.test("SACD replacement and removal affect only the physical ISO", async () => {
      database.upsertTracks([
        makeTrack("old-sacd", `${iso}|Track01|0|2000`),
        makeTrack("other-sacd", `${path.join(sibling, "disc.iso")}|Track01|0|2000`),
      ]);
      sacdTracks = [
        {
          path: `${iso}|Track02|0|2000`,
          title: "New SACD",
          duration: 2,
          codec: "sacd_dsd",
          sampleRate: 2822400,
          channels: 2,
          bitRate: 5644800,
          bitsPerSample: 1,
          fileSize: 1,
          mtime: 2,
          ctime: 1,
        },
      ];
      scanner.startScan([scope]);
      callback({
        eventType: "progress",
        total: 1,
        scanned: 1,
        tracks: [{ ...sacdTracks[0], path: iso }],
      });
      assert.equal((await finish({ total: 1, scanned: 1 })).changed, true);
      assert.deepEqual(
        database.getTracksByPhysicalPaths([iso]).map((track) => track.title),
        ["New SACD"],
      );
      scanner.startScan([scope]);
      assert.equal((await finish({ removedPaths: [iso] })).changed, true);
      assert.deepEqual(database.getTracksByPhysicalPaths([iso]), []);
      assert.equal(database.getTracksByPhysicalPaths([path.join(sibling, "disc.iso")]).length, 1);
    });
  } finally {
    removeWsClient(ws);
    database.closeDatabase();
    hooks.deregister();
    Reflect.deleteProperty(globalThis, engineKey);
    if (previousDataDir === undefined) delete process.env.ATOM_DATA_DIR;
    else process.env.ATOM_DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
