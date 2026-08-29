import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (url: URL): string => readFileSync(url, "utf8");
const serviceSource = read(new URL("./providerApi.ts", import.meta.url));
const ipcSource = read(new URL("../ipc/apis.ts", import.meta.url));
const routesSource = read(new URL("../atom/headless/routes.ts", import.meta.url));
const preloadSource = read(new URL("../../preload/index.ts", import.meta.url));
const webApiSource = read(new URL("../../../src/web/api.ts", import.meta.url));
const providerClientSource = read(new URL("../../../src/core/providerClient.ts", import.meta.url));
const projectionStoreSource = read(
  new URL("../../../src/stores/providerSessions.ts", import.meta.url),
);
const userStoreSource = read(new URL("../../../src/stores/user.ts", import.meta.url));
const neteaseSource = read(new URL("../../../src/apis/netease.ts", import.meta.url));
const qobuzSource = read(new URL("../../../src/apis/qobuz.ts", import.meta.url));
const tidalSource = read(new URL("../../../src/apis/tidal.ts", import.meta.url));
const qqSource = read(new URL("../../../src/apis/qqmusic.ts", import.meta.url));
const kugouSource = read(new URL("../../../src/apis/kugou.ts", import.meta.url));
const cookieDialogSource = read(
  new URL("../../../src/components/modals/LoginCookieDialog.vue", import.meta.url),
);

test("Core owns one token-free provider session snapshot for Netease Qobuz and TIDAL", () => {
  assert.match(serviceSource, /getNeteaseCookies\(\)\.MUSIC_U/);
  assert.match(serviceSource, /getQobuzAuthStatus\(\)/);
  assert.match(serviceSource, /getTidalAuthStatus\(\)/);
  assert.match(serviceSource, /publishDesktopEvent\("apis:sessions", snapshot\)/);
  assert.match(serviceSource, /wsBroadcast\(\{ type: "providerSessions", data: snapshot \}\)/);
  assert.match(serviceSource, /publishProviderSessionsIfChanged\(\)/);
  assert.doesNotMatch(serviceSource, /accessToken|user_auth_token|MUSIC_U:/);
});

test("Managed Provider requests use Core Protocol while session events keep the existing event transport", () => {
  assert.match(routesSource, /api\.post\("\/providers\/call"/);
  assert.match(routesSource, /api\.get\("\/providers\/sessions"/);
  assert.match(routesSource, /api\.post\("\/providers\/clear-session"/);
  assert.match(routesSource, /api\.post\("\/providers\/set-cookie"/);

  assert.match(providerClientSource, /request<ApiCallResponse>\("\/providers\/call"/);
  assert.match(
    providerClientSource,
    /request<ProviderSessionsSnapshot>\("\/providers\/sessions"\)/,
  );
  assert.match(providerClientSource, /"\/providers\/clear-session"/);
  assert.match(providerClientSource, /"\/providers\/set-cookie"/);

  assert.match(projectionStoreSource, /providerClient\.getSessions\(\)/);
  assert.match(projectionStoreSource, /window\.api\.apis\.onSessionsChange\(apply\)/);
  assert.match(preloadSource, /subscribe<ProviderSessionsSnapshot>\("apis:sessions", callback\)/);
  assert.match(webApiSource, /providerClient\.call\(platform, name, params\)/);
  assert.match(webApiSource, /event\.type === "providerSessions"/);

  const obsoleteRequestIpc = /apis:(getSessions|clearSession|setCookie)/;
  assert.doesNotMatch(ipcSource, obsoleteRequestIpc);
  assert.doesNotMatch(preloadSource, obsoleteRequestIpc);
});

test("Atom-managed provider wrappers use Core Protocol while QQ and Kugou remain frozen compatibility IPC", () => {
  assert.match(neteaseSource, /providerClient\.call\("netease", name, params\)/);
  assert.match(neteaseSource, /providerClient\.clearSession\("netease"\)/);
  assert.match(qobuzSource, /providerClient\.call\("qobuz", name, params\)/);
  assert.match(tidalSource, /providerClient\.call\("tidal", name, params\)/);
  assert.match(cookieDialogSource, /providerClient\.setCookie\("netease", value\)/);

  assert.match(qqSource, /window\.api\.apis\.call\("qqmusic", name, params\)/);
  assert.match(kugouSource, /window\.api\.apis\.call\("kugou", name, params\)/);
});

test("Control provider projection is non-persistent and Netease login UI reads Core authority", () => {
  assert.doesNotMatch(projectionStoreSource, /persist|localStorage|localforage/);
  assert.match(userStoreSource, /providerSessions\.isAuthenticated\("netease"\)/);
  assert.doesNotMatch(userStoreSource, /isLoggedIn = computed\(\(\) => profile\.value !== null\)/);
});
