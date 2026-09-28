import assert from "node:assert/strict";
import test from "node:test";
import { appendFolderPath, folderPathWithinRoot } from "./folderPath";

test("folderPathWithinRoot handles POSIX paths without prefix collisions", () => {
  assert.equal(folderPathWithinRoot("/music/Album", "/music"), true);
  assert.equal(folderPathWithinRoot("/music", "/music/"), true);
  assert.equal(folderPathWithinRoot("/music-extra/Album", "/music"), false);
});

test("folderPathWithinRoot handles Windows drive paths case-insensitively", () => {
  assert.equal(folderPathWithinRoot("C:\\Music\\Album", "c:\\music"), true);
  assert.equal(folderPathWithinRoot("C:\\MusicBox", "C:\\Music"), false);
});

test("folderPathWithinRoot handles UNC paths case-insensitively", () => {
  assert.equal(folderPathWithinRoot("\\\\NAS\\Music\\Album", "\\\\nas\\music"), true);
  assert.equal(folderPathWithinRoot("\\\\NAS\\Music2", "\\\\nas\\music"), false);
});

test("appendFolderPath preserves the configured path separator style", () => {
  assert.equal(appendFolderPath("/music", "Album"), "/music/Album");
  assert.equal(appendFolderPath("C:\\Music", "Album"), "C:\\Music\\Album");
  assert.equal(appendFolderPath("\\\\NAS\\Music\\", "Album"), "\\\\NAS\\Music\\Album");
});
