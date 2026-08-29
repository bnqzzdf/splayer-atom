import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (url: URL): string => readFileSync(url, "utf8");
const serviceSource = read(new URL("./providerApi.ts", import.meta.url));
const ipcSource = read(new URL("../ipc/apis.ts", import.meta.url));
const routesSource = read(new URL("../atom/headless/routes.ts", import.meta.url));
const preloadSource = read(new URL("../../preload/index.ts", import.meta.url));
const webApiSource = read(new URL("../../../src/web/api.ts", import.meta.url));
const projectionStoreSource = read(
  new URL("../../../src/stores/providerSessions.ts", import.meta.url),
);
const userStoreSource = read(new URL("../../../src/stores/user.ts", import.meta.url));

test("Core owns one token-free provider session snapshot for Netease Qobuz and TIDAL", () => {
  assert.match(serviceSource, /getNeteaseCookies\(\)\.MUSIC_U/);
  assert.match(serviceSource, /getQobuzAuthStatus\(\)/);
  assert.match(serviceSource, /getTidalAuthStatus\(\)/);
  assert.match(serviceSource, /publishDesktopEvent\("apis:sessions", snapshot\)/);
  assert.match(serviceSource, /wsBroadcast\(\{ type: "providerSessions", data: snapshot \}\)/);
  assert.match(serviceSource, /publishProviderSessionsIfChanged\(\)/);
  assert.doesNotMatch(serviceSource, /accessToken|user_auth_token|MUSIC_U:/);
});

test("Desktop and Web expose the same provider session snapshot and event contract", () => {
  assert.match(ipcSource, /apis:getSessions/);
  assert.match(ipcSource, /publishProviderSessionsIfChanged\(\)/);
  assert.match(routesSource, /api\.get\("\/providers\/sessions"/);
  assert.match(preloadSource, /getSessions: \(\) => ipcRenderer\.invoke\("apis:getSessions"\)/);
  assert.match(preloadSource, /subscribe<ProviderSessionsSnapshot>\("apis:sessions", callback\)/);
  assert.match(webApiSource, /request<ProviderSessionsSnapshot>\("\/providers\/sessions"\)/);
  assert.match(webApiSource, /event\.type === "providerSessions"/);
});

test("Control provider projection is non-persistent and Netease login UI reads Core authority", () => {
  assert.match(projectionStoreSource, /window\.api\.apis\.getSessions\(\)/);
  assert.match(projectionStoreSource, /window\.api\.apis\.onSessionsChange\(apply\)/);
  assert.doesNotMatch(projectionStoreSource, /persist|localStorage|localforage/);
  assert.match(userStoreSource, /providerSessions\.isAuthenticated\("netease"\)/);
  assert.doesNotMatch(userStoreSource, /isLoggedIn = computed\(\(\) => profile\.value !== null\)/);
});
