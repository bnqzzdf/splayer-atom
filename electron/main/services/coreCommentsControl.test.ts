import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serviceSource = readFileSync(new URL("./comments/index.ts", import.meta.url), "utf8");
const ipcSource = readFileSync(new URL("../ipc/comments.ts", import.meta.url), "utf8");
const routesSource = readFileSync(new URL("../atom/headless/routes.ts", import.meta.url), "utf8");
const webApiSource = readFileSync(new URL("../../../src/web/api.ts", import.meta.url), "utf8");
const clientSource = readFileSync(
  new URL("../../../src/core/commentsClient.ts", import.meta.url),
  "utf8",
);
const dialogSource = readFileSync(
  new URL("../../../src/components/modals/MusicCommentsDialog.vue", import.meta.url),
  "utf8",
);

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

test("Desktop and Web renderer comments requests share one Core client", () => {
  assert.match(clientSource, /request<CommentSource\[\]>\("\/comments\/sources"\)/);
  assert.match(clientSource, /request<MusicCommentResponse>\("\/comments\/music"/);
  assert.match(clientSource, /track: toServerTrack\(args\.track\)/);
  assert.match(dialogSource, /commentsClient\.sources\(\)/);
  assert.match(dialogSource, /commentsClient\.get\(\{/);
  assert.doesNotMatch(dialogSource, /window\.api\.comments\./);
  assert.match(webApiSource, /comments: commentsClient/);
  assert.doesNotMatch(webApiSource, /comments: \{\s*sources:/s);
});
