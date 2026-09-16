import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

const controlService = read("core/services/streaming/control.ts");
const routesSource = read("core/atom/headless/routes.ts");
const syncSource = read("core/services/streaming/sync.ts");
const librarySource = read("core/services/streaming/library.ts");
const sharedTypes = read("shared/types/streaming.ts");
const eventTypes = read("shared/types/coreEvents.ts");
const storeSource = read("src/stores/streaming.ts");
const lyricRequestSource = read("src/services/lyric/request.ts");
const playbackResolver = read("core/services/playbackSourceResolver.ts");

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

test("Streaming management and library business live in one Core service", () => {
  assert.doesNotMatch(controlService, /from "electron"|ipcMain/);
  assert.match(controlService, /addStreamingServer/);
  assert.match(controlService, /updateStreamingServer/);
  assert.match(controlService, /queueStreamingSync/);
  assert.match(controlService, /getLibrarySnapshot/);
  assert.match(controlService, /withStreamingAdapter/);
  assert.match(controlService, /fetchBytes/);
});

test("Web Streaming Control uses Core Protocol while playable URLs stay out of it", () => {
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

  for (const method of migratedIpcMethods) {
    assert.match(
      controlService + routesSource,
      new RegExp(method === "loadServers" ? "loadStreamingConfig|getStreamingConfig" : ".*"),
    );
  }
  assert.doesNotMatch(sharedTypes, /interface StreamingApi/);
  assert.doesNotMatch(storeSource, /window\.api\.streaming|getStreamUrl/);
  assert.match(playbackResolver, /adapter\.getStreamUrl/);
});

test("Streaming library refresh uses the shared Core event envelope", () => {
  assert.match(eventTypes, /type: "streamingLibraryUpdated"/);
  assert.match(
    syncSource,
    /publishCoreControlEvent\(\{ type: "streamingLibraryUpdated", data: \{ serverId \} \}\)/,
  );
  assert.doesNotMatch(syncSource, /sendToMain\("streaming:libraryUpdated"/);
  assert.match(storeSource, /streamingClient\.onLibraryUpdated/);
});

test("Streaming search stays Core-owned and includes playlists", () => {
  assert.match(controlService, /searchLibrary\(serverId, query\.slice\(0, 200\)\)/);
  assert.match(librarySource, /playlists: getPlaylists\(serverId\)\.filter/);
  assert.match(sharedTypes, /playlists: Playlist\[\]/);
});
