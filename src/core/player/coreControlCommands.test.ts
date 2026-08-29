import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const playerSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const playerClientSource = readFileSync(new URL("../playerClient.ts", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../../stores/settings.ts", import.meta.url), "utf8");
const playerCoverSource = readFileSync(
  new URL("../../components/player/FullPlayer/PlayerCover.vue", import.meta.url),
  "utf8",
);
const lyricLoaderSource = readFileSync(
  new URL("../../services/lyric/loader.ts", import.meta.url),
  "utf8",
);
const fftCaptureSource = readFileSync(
  new URL("../../services/fftCapture.ts", import.meta.url),
  "utf8",
);
const lyricPosterSource = readFileSync(
  new URL("../../utils/lyric/poster.ts", import.meta.url),
  "utf8",
);

const between = (start: string, end: string): string => {
  const afterStart = playerSource.split(start)[1];
  assert.ok(afterStart, `missing start marker: ${start}`);
  return afterStart.split(end)[0] ?? "";
};

test("ordinary Control queue commands let Core load the selected track", () => {
  const playFrom = between("export const playFrom = async (", "/** 标签写入后恢复当前曲");
  assert.match(playFrom, /replaceSessionQueue\(/);
  assert.match(playFrom, /!isSameTrack/);
  assert.doesNotMatch(playFrom, /loadTrack\(/);

  const playAt = between("export const playAtIndex = async (", "/** 播放上一首");
  assert.match(playAt, /selectSessionIndex\(index, true, true\)/);
  assert.doesNotMatch(playAt, /loadTrack\(/);

  const previous = between("export const prevTrack = async (", "/** 队列播放结束");
  assert.match(previous, /prevSession\(true\)/);
  assert.doesNotMatch(previous, /loadTrack\(/);
});

test("queue replacement/removal and play-now no longer reload through renderer", () => {
  const heart = between("export const playHeartMode = async (", "/** 退出心动模式");
  assert.match(heart, /replaceSessionQueue\(toQueueItems\(tracks\), 0, true, true\)/);
  assert.doesNotMatch(heart, /loadTrack\(/);

  const remove = between("export const removeFromQueue = async (", "/**\n * 文件删除后同步队列");
  assert.match(remove, /removeSessionQueueIndex\(index, isCurrentPlaying\)/);
  assert.doesNotMatch(remove, /loadTrack\(/);

  const playNow = between("export const playNow = async (", "/**\n * 移动队列中的歌曲位置");
  assert.match(playNow, /selectSessionIndex\(insertedIndex, true, true\)/);
  assert.doesNotMatch(playNow, /loadTrack\(/);
});

test("renderer processing and status controls use Core Protocol instead of Player IPC", () => {
  assert.match(playerClientSource, /coreResult<PlayerStatus>\("\/status"\)/);
  assert.match(playerClientSource, /coreCommand\("\/volume", \{ volume \}\)/);
  assert.match(playerClientSource, /coreCommand\("\/player\/speed", \{ speed \}\)/);
  assert.match(playerClientSource, /coreCommand\("\/player\/pitch-sync", \{ enabled \}\)/);
  assert.match(playerClientSource, /coreCommand\("\/player\/normalization", \{ enabled \}\)/);
  assert.match(playerClientSource, /coreCommand\("\/player\/equalizer"/);
  assert.match(playerClientSource, /coreCommand\("\/player\/fade", \{ durationMs \}\)/);

  const processingIpc =
    /window\.api\.player\.(getStatus|setVolume|setSpeed|setPitch|setPitchSync|setFadeDuration|setNormalizationEnabled|setEqualizerBands|setPreampGain|setEqualizerEnabled)/;
  assert.doesNotMatch(playerSource, processingIpc);
  assert.doesNotMatch(settingsSource, processingIpc);
});

test("distributed player helpers use Core Protocol while Host presentation and events stay separate", () => {
  assert.match(playerClientSource, /coreCommand\("\/player\/fft", \{ enabled \}\)/);
  assert.match(playerClientSource, /coreResult<\{ data: string \| null \}>\("\/player\/cover"\)/);
  assert.match(playerClientSource, /coreResult<\{ data: string \}>\("\/player\/read-lyric"/);

  assert.match(playerCoverSource, /playerClient\.getCoverRaw\(\)/);
  assert.match(lyricPosterSource, /playerClient\.getCoverRaw\(\)/);
  assert.match(lyricLoaderSource, /playerClient\.readLyricFile\(ext\.path\)/);
  assert.match(fftCaptureSource, /playerClient\.setFftEnabled\(true\)/);
  assert.match(fftCaptureSource, /playerClient\.setFftEnabled\(false\)/);

  const migratedIpc = /window\.api\.player\.(getCoverRaw|readLyricFile|setFftEnabled|getFftData)/;
  for (const source of [
    playerCoverSource,
    lyricPosterSource,
    lyricLoaderSource,
    fftCaptureSource,
  ]) {
    assert.doesNotMatch(source, migratedIpc);
  }
  assert.match(playerSource, /window\.api\.player\.syncPlayMode/);
  assert.match(playerSource, /window\.api\.player\.syncLikeState/);
  assert.match(playerSource, /window\.api\.player\.onEvent/);
});

test("next always delegates playback advancement to the Core session", () => {
  const next = between(
    "export const nextTrack = async (): Promise<void> => {",
    "/**\n * 跳到队列指定位置",
  );
  assert.match(next, /nextSession\(true\)/);
  assert.doesNotMatch(next, /fm\.|fmMode|loadTrack\(/);
});
