import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (url: URL): string => readFileSync(url, "utf8");
const routesSource = read(new URL("../atom/compat/routes.ts", import.meta.url));
const clientSource = read(new URL("../../../src/core/playlistClient.ts", import.meta.url));
const storeSource = read(new URL("../../../src/stores/playlist.ts", import.meta.url));
const webApiSource = read(new URL("../../../src/web/api.ts", import.meta.url));

test("Core exposes the complete local Playlist request contract", () => {
  for (const route of [
    'api.get("/playlists"',
    'api.get("/playlists/:id"',
    'api.post("/playlists"',
    'api.patch("/playlists/:id"',
    'api.delete("/playlists/:id"',
    'api.post("/playlists/:id/tracks"',
    'api.delete("/playlists/:id/tracks"',
    'api.post("/playlists/import-legacy"',
    'api.delete("/playlists"',
  ]) {
    assert.ok(routesSource.includes(route), `missing Playlist route: ${route}`);
  }
  assert.match(clientSource, /request<PlaylistSummary\[]>\("\/playlists"\)/);
  assert.match(clientSource, /"\/playlists\/import-legacy"/);
});

test("Desktop and Web Playlist requests share one client and one renderer store", () => {
  for (const method of [
    "importLegacy",
    "list",
    "get",
    "create",
    "update",
    "remove",
    "addTracks",
    "removeTracks",
    "clear",
  ]) {
    assert.match(storeSource, new RegExp(`playlistClient\\.${method}\\(`));
  }
  assert.doesNotMatch(storeSource, /window\.api\.playlist\./);
  assert.match(
    storeSource,
    /localforage\.createInstance\(\{ name: "splayer", storeName: "playlists" \}\)/,
  );
  assert.match(storeSource, /playlistClient\.importLegacy\(records\)/);
  assert.match(webApiSource, /playlist: playlistClient/);
  assert.doesNotMatch(webApiSource, /const playlistApi:/);
});
