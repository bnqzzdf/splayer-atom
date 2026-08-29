import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

const controlService = read("electron/main/services/streaming/control.ts");
const ipcSource = read("electron/main/ipc/streaming.ts");
const routesSource = read("electron/main/atom/headless/routes.ts");
const syncSource = read("electron/main/services/streaming/sync.ts");
const preloadSource = read("electron/preload/index.ts");
const sharedTypes = read("shared/types/streaming.ts");
const eventTypes = read("shared/types/coreEvents.ts");
const storeSource = read("src/stores/streaming.ts");
const lyricRequestSource = read("src/services/lyric/request.ts");
const webApiSource = read("src/web/api.ts");

const migratedIpcMethods = [
  "loadServers",
  "addServer",
  "updateServer",
  "removeServer",
  "setActiveServer",
  "testConnection",
  "connect",
  "disconnect",
  "getSnapshot",
  "sync",
  "search",
  "getAlbumSongs",
  "getPlaylistSongs",
  "getArtistAlbums",
  "getArtistSongs",
  "getLyrics",
] as const;

test("Streaming management and library business live in one Electron-free Core service", () => {
  assert.doesNotMatch(controlService, /from "electron"/);
  assert.match(controlService, /addStreamingServer/);
  assert.match(controlService, /updateStreamingServer/);
  assert.match(controlService, /queueStreamingSync/);
  assert.match(controlService, /getLibrarySnapshot/);
  assert.match(controlService, /withStreamingAdapter/);
  assert.match(controlService, /fetchBytes/);
});

test("Desktop and Web Streaming Controls share Core Protocol while playable URLs stay out of it", () => {
  for (const path of [
    "/streaming/config",
    "/streaming/server",
    "/streaming/active",
    "/streaming/test",
    "/streaming/connect",
    "/streaming/disconnect",
    "/streaming/snapshot",
    "/streaming/sync",
    "/streaming/search",
    "/streaming/album-songs",
    "/streaming/playlist-songs",
    "/streaming/artist-albums",
    "/streaming/artist-songs",
    "/streaming/lyrics",
    "/streaming/cover",
  ]) {
    assert.match(routesSource, new RegExp(path.replaceAll("/", "\\/")));
  }
  assert.doesNotMatch(
    routesSource,
    /streaming\/stream-url|streaming\/playable|streamingControl\.getStreamUrl/,
  );
  assert.match(storeSource, /from "@\/core\/streamingClient"/);
  assert.match(lyricRequestSource, /streamingClient\.getLyrics/);
  assert.match(webApiSource, /streaming:\s*\{\s*\.\.\.streamingClient/s);

  for (const method of migratedIpcMethods) {
    assert.doesNotMatch(ipcSource, new RegExp(`streaming:${method}`));
    assert.doesNotMatch(preloadSource, new RegExp(`streaming:${method}`));
  }
  assert.match(ipcSource, /streaming:getStreamUrl/);
  assert.match(preloadSource, /streaming:getStreamUrl/);
  assert.doesNotMatch(sharedTypes, /loadServers:|onLibraryUpdated:|getLyrics:/);
});

test("Streaming library refresh uses the shared Core event envelope", () => {
  assert.match(eventTypes, /type: "streamingLibraryUpdated"/);
  assert.match(
    syncSource,
    /publishCoreControlEvent\(\{ type: "streamingLibraryUpdated", data: \{ serverId \} \}\)/,
  );
  assert.doesNotMatch(syncSource, /sendToMain\("streaming:libraryUpdated"/);
  assert.doesNotMatch(preloadSource, /streaming:libraryUpdated/);
  assert.match(storeSource, /streamingClient\.onLibraryUpdated/);
});
