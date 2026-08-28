import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const playerSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

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

test("next always delegates playback advancement to the Core session", () => {
  const next = between(
    "export const nextTrack = async (): Promise<void> => {",
    "/**\n * 跳到队列指定位置",
  );
  assert.match(next, /nextSession\(true\)/);
  assert.doesNotMatch(next, /fm\.|fmMode|loadTrack\(/);
});
