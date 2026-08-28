import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { neteaseSongToTrack } from "../../../shared/utils/neteaseTrack";

const sessionSource = readFileSync(new URL("./playbackSession.ts", import.meta.url), "utf8");
const fmSource = readFileSync(new URL("./personalFm.ts", import.meta.url), "utf8");
const controlSource = readFileSync(
  new URL("../../../src/core/player/index.ts", import.meta.url),
  "utf8",
);

test("Core owns the Personal FM recommendation pool and canonical queue mode", () => {
  assert.match(fmSource, /callNetease\("personal_fm"/);
  assert.match(fmSource, /callNetease\("fm_trash"/);
  assert.match(sessionSource, /mode: PlaybackSessionMode = "queue"/);
  assert.match(sessionSource, /mode = active \? "personalFm" : "queue"/);
  assert.match(sessionSource, /startPersonalFmPool\(options\)/);
  assert.match(
    sessionSource,
    /if \(mode === "personalFm"\) return advancePersonalFm\(loadCurrent\)/,
  );
});

test("Personal FM playback uses the same Core load and preload path", () => {
  const start = sessionSource.split("export const startPersonalFm = async (")[1];
  assert.ok(start, "Core FM entry should exist");
  assert.match(start, /loadIndexWithPolicy\(0, autoPlay\)/);
  assert.match(sessionSource, /scheduleNextPlaybackPreload\(\)/);
  assert.match(sessionSource, /alignPersonalFmPool\(targetIndex\)/);
});

test("Control no longer fetches or advances a renderer-owned FM pool", () => {
  assert.doesNotMatch(controlSource, /from "\.\/fm"/);
  const next = controlSource.split("export const nextTrack = async (): Promise<void> => {")[1];
  assert.ok(next, "Control next command should exist");
  assert.match(next.split("};")[0], /nextSession\(true\)/);
  assert.doesNotMatch(next.split("};")[0], /fm\.|loadTrack\(/);
});

test("shared Netease mapping preserves canonical playback metadata", () => {
  const track = neteaseSongToTrack({
    id: 42,
    name: "FM Track",
    ar: [{ id: 7, name: "Artist" }],
    al: { id: 9, name: "Album", picUrl: "https://img.example/cover.jpg" },
    dt: 123_000,
    fee: 1,
    sq: { sr: 44_100, br: 999_000 },
  });
  assert.equal(track.source, "netease");
  assert.equal(track.id, "42");
  assert.equal(track.artists[0]?.name, "Artist");
  assert.equal(track.duration, 123_000);
  assert.equal(track.fee, 1);
  assert.equal(track.quality?.codec, "flac");
  assert.match(track.cover ?? "", /\?param=300y300$/);
});
