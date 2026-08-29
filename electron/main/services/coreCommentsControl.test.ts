import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serviceSource = readFileSync(new URL("./comments/index.ts", import.meta.url), "utf8");
const ipcSource = readFileSync(new URL("../ipc/comments.ts", import.meta.url), "utf8");
const routesSource = readFileSync(new URL("../atom/headless/routes.ts", import.meta.url), "utf8");
const webApiSource = readFileSync(new URL("../../../src/web/api.ts", import.meta.url), "utf8");

test("Comments business already lives in an Electron-free Core service", () => {
  assert.doesNotMatch(serviceSource, /from "electron"/);
  assert.match(serviceSource, /export const getCommentSources/);
  assert.match(serviceSource, /export const getMusicComments/);
  assert.match(serviceSource, /pluginRegistry/);
  assert.match(serviceSource, /callNetease/);
});

test("Desktop and Headless Controls reuse the same Core comments service", () => {
  assert.match(ipcSource, /getCommentSources\(\)/);
  assert.match(ipcSource, /await getMusicComments\(args\)/);
  assert.match(routesSource, /api\.get\("\/comments\/sources"/);
  assert.match(routesSource, /api\.post\("\/comments\/music"/);
  assert.match(routesSource, /await getMusicComments\(body\)/);
});

test("Web comments facade projects real Core sources and pages instead of empty no-ops", () => {
  assert.match(webApiSource, /request<CommentSource\[\]>\("\/comments\/sources"\)/);
  assert.match(webApiSource, /request<MusicCommentResponse>\("\/comments\/music"/);
  assert.match(webApiSource, /track: toServerTrack\(args\.track\)/);
  assert.doesNotMatch(webApiSource, /sources: async \(\) => \[\]/);
  assert.doesNotMatch(webApiSource, /comments: \[\], total: 0, hasMore: false/);
});
