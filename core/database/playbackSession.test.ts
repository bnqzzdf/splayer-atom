import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { PlaybackQueueItem, PlaybackSessionSnapshot } from "@shared/types/player";

test("persisted CUE queue restores exact 75fps coordinates from canonical library tracks", async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "splayer-playback-cue-restore-"));
  const previousDataDir = process.env.ATOM_DATA_DIR;
  process.env.ATOM_DATA_DIR = dataDir;

  const database = await import("./index");
  const playbackSession = await import("./playbackSession");
  try {
    database.initDatabase();
    database.upsertTracks([
      {
        id: "cue-01",
        path: "cue:///music/album.cue#track=01",
        cuePath: "/music/album.cue",
        cueAudioPath: "/music/album.flac",
        cueStartMs: 0,
        cueEndMs: 13,
        cueStartFrame75: 0,
        cueEndFrame75: 1,
        title: "Track 1",
        track: 1,
        artists: [],
        duration: 13,
        fileSize: 1,
        mtime: 1,
        ctime: 1,
      },
      {
        id: "cue-02",
        path: "cue:///music/album.cue#track=02",
        cuePath: "/music/album.cue",
        cueAudioPath: "/music/album.flac",
        cueStartMs: 13,
        cueEndMs: 1_000,
        cueStartFrame75: 1,
        title: "Track 2",
        track: 2,
        artists: [],
        duration: 987,
        fileSize: 1,
        mtime: 1,
        ctime: 1,
      },
    ]);

    const oldQueue: PlaybackQueueItem[] = [
      {
        track: {
          id: "cue-01",
          source: "local",
          path: "cue:///music/album.cue#track=01",
          cuePath: "/music/album.cue",
          cueAudioPath: "/music/album.flac",
          cueStartMs: 0,
          cueEndMs: 13,
          title: "Track 1",
          artists: [],
          duration: 13,
        },
      },
      {
        track: {
          id: "cue-02",
          source: "local",
          path: "cue:///music/album.cue#track=02",
          cuePath: "/music/album.cue",
          cueAudioPath: "/music/album.flac",
          cueStartMs: 13,
          cueEndMs: 1_000,
          title: "Track 2",
          artists: [],
          duration: 987,
        },
      },
    ];
    const snapshot: PlaybackSessionSnapshot = {
      active: true,
      mode: "queue",
      queue: oldQueue,
      originalQueue: [...oldQueue],
      index: 0,
      current: oldQueue[0].track,
      repeat: "off",
      shuffle: "off",
    };

    playbackSession.savePlaybackSession(snapshot);
    const restored = playbackSession.loadPlaybackSession();

    assert.equal(restored?.queue[0].track.cueStartFrame75, 0);
    assert.equal(restored?.queue[0].track.cueEndFrame75, 1);
    assert.equal(restored?.queue[1].track.cueStartFrame75, 1);
    assert.equal(restored?.queue[1].track.cueEndFrame75, undefined);
    assert.equal(restored?.originalQueue?.[0].track.cueEndFrame75, 1);
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
