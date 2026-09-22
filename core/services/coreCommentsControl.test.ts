import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serviceSource = readFileSync(new URL("./comments/index.ts", import.meta.url), "utf8");
const routesSource = readFileSync(new URL("../atom/headless/routes.ts", import.meta.url), "utf8");
const clientSource = readFileSync(
  new URL("../../src/core/commentsClient.ts", import.meta.url),
  "utf8",
);
const dialogSource = readFileSync(
  new URL("../../src/components/modals/MusicCommentsDialog.vue", import.meta.url),
  "utf8",
);

test("Comments business lives in one Core service", () => {
  assert.doesNotMatch(serviceSource, /from "electron"|ipcMain/);
  assert.match(serviceSource, /export const getCommentSources/);
  assert.match(serviceSource, /export const getMusicComments/);
  assert.match(serviceSource, /pluginRegistry/);
  assert.match(serviceSource, /callNetease/);
});

test("Web Control routes reuse the Core comments service", () => {
  assert.match(routesSource, /api\.get\("\/comments\/sources"/);
  assert.match(routesSource, /api\.post\("\/comments\/music"/);
  assert.match(routesSource, /await getMusicComments\(body\)/);
});

test("Web renderer comments requests use one Core client", () => {
  assert.match(clientSource, /request<CommentSource\[\]>\("\/comments\/sources"\)/);
  assert.match(clientSource, /request<MusicCommentResponse>\("\/comments\/music"/);
  assert.match(clientSource, /track: toServerTrack\(args\.track\)/);
  assert.match(dialogSource, /commentsClient\.sources\(\)/);
  assert.match(dialogSource, /commentsClient\.get\(\{/);
  assert.doesNotMatch(dialogSource, /window\.api\.comments\./);
});
