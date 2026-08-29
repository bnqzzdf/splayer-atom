import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const controlSource = readFileSync(
  new URL("../../../src/core/player/index.ts", import.meta.url),
  "utf8",
);

test("tag-write recovery reloads the canonical current Track through Core", () => {
  const resume = controlSource.split("const resumeAfterTagWrite = async (")[1];
  assert.ok(resume);
  const body = resume.split("/**\n * 写入本地文件标签")[0] ?? resume;
  assert.match(body, /reloadSessionCurrent\(false\)/);
  assert.match(body, /if \(resumeMs > 0\) await seek\(resumeMs\)/);
  assert.match(body, /if \(wasPlaying\) await play\(\)/);
  assert.doesNotMatch(body, /\.load\(/);
});

test("Desktop Control has no raw playable-source load path", () => {
  assert.doesNotMatch(controlSource, /window\.api\.player\.load\(/);
  assert.doesNotMatch(controlSource, /resolveTrackSource|loadTrackSourceWithFallback/);
});

test("tag writes release the current file before mutation and refresh Core queue metadata", () => {
  const save = controlSource.split("export const saveTrackTags = async (")[1];
  assert.ok(save);
  const body = save.split("/**\n * 进入心动模式")[0] ?? save;
  const stopIndex = body.indexOf("await window.api.player.stop()");
  const writeIndex = body.indexOf("window.api.library.writeTags(edits)");
  const updateIndex = body.indexOf("window.api.player.updateSessionQueueTracks(updated)");
  const resumeIndex = body.lastIndexOf("resumeAfterTagWrite(resumeMs, wasPlaying)");
  assert.ok(stopIndex >= 0);
  assert.ok(writeIndex > stopIndex);
  assert.ok(updateIndex > writeIndex);
  assert.ok(resumeIndex > updateIndex);
});
