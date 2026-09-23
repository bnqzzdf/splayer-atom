import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (url: URL): string => readFileSync(url, "utf8");
const serviceSource = read(new URL("./providerApi.ts", import.meta.url));
const routesSource = read(new URL("../atom/headless/routes.ts", import.meta.url));
const providerClientSource = read(new URL("../../src/core/providerClient.ts", import.meta.url));
const projectionStoreSource = read(
  new URL("../../src/stores/providerSessions.ts", import.meta.url),
);
const userStoreSource = read(new URL("../../src/stores/user.ts", import.meta.url));
const neteaseSource = read(new URL("../../src/apis/netease.ts", import.meta.url));
const qqmusicSource = read(new URL("../../src/apis/qqmusic.ts", import.meta.url));
const kugouSource = read(new URL("../../src/apis/kugou.ts", import.meta.url));
const qobuzSource = read(new URL("../../src/apis/qobuz.ts", import.meta.url));
const tidalSource = read(new URL("../../src/apis/tidal.ts", import.meta.url));
const qobuzAuthSource = read(new URL("../apis/qobuz/auth.ts", import.meta.url));
const tidalAuthSource = read(new URL("../apis/tidal/auth.ts", import.meta.url));
const cookieDialogSource = read(
  new URL("../../src/components/modals/LoginCookieDialog.vue", import.meta.url),
);

test("Core owns one token-free provider session snapshot for Netease Qobuz and TIDAL", () => {
  assert.match(serviceSource, /getNeteaseCookies\(\)\.MUSIC_U/);
  assert.match(serviceSource, /getQobuzAuthStatus\(\)/);
  assert.match(serviceSource, /getTidalAuthStatus\(\)/);
  assert.match(
    serviceSource,
    /publishCoreControlEvent\(\{ type: "providerSessions", data: snapshot \}\)/,
  );
  assert.match(serviceSource, /publishProviderSessionsIfChanged\(\)/);
  assert.doesNotMatch(serviceSource, /accessToken|user_auth_token|MUSIC_U:/);
});

test("Managed Provider requests and session projection use the Core Control transport", () => {
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
  assert.match(projectionStoreSource, /subscribeCoreControlEvent\("providerSessions", apply\)/);
  assert.doesNotMatch(projectionStoreSource, /window\.api|ipcRenderer|electron/);
});

test("Atom-managed provider wrappers use Core Protocol for every online platform", () => {
  assert.match(neteaseSource, /providerClient\.call\("netease", name, params\)/);
  assert.match(neteaseSource, /providerClient\.clearSession\("netease"\)/);
  assert.match(qqmusicSource, /providerClient\.call\("qqmusic", name, params\)/);
  assert.match(kugouSource, /providerClient\.call\("kugou", name, params\)/);
  assert.match(qobuzSource, /providerClient\.call\("qobuz", name, params\)/);
  assert.match(tidalSource, /providerClient\.call\("tidal", name, params\)/);
  assert.match(cookieDialogSource, /providerClient\.setCookie\(props\.platform, value\)/);
  assert.match(providerClientSource, /ManagedProviderPlatform/);
  assert.doesNotMatch(providerClientSource, /qqmusic|kugou/);
});

test("Core persists managed streaming credentials while Control projection stays non-persistent", () => {
  for (const authSource of [qobuzAuthSource, tidalAuthSource]) {
    assert.match(authSource, /const STORAGE_FILE = path\.join\(configDir,/);
    assert.match(authSource, /runtimeSecretCodec\.encode\(plain\)/);
    assert.match(authSource, /fs\.readFileSync\(STORAGE_FILE/);
    assert.match(authSource, /fs\.chmodSync\(STORAGE_FILE, 0o600\)/);
  }

  assert.doesNotMatch(projectionStoreSource, /persist|localStorage|localforage/);
  assert.match(projectionStoreSource, /providerClient\.getSessions\(\)/);
  assert.match(userStoreSource, /providerSessions\.isAuthenticated\("netease"\)/);
  assert.doesNotMatch(userStoreSource, /isLoggedIn = computed\(\(\) => profile\.value !== null\)/);
});
