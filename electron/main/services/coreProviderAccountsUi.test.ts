import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (url: URL): string => readFileSync(url, "utf8");
const panelSource = read(
  new URL("../../../src/components/settings/custom/ProviderAccounts.vue", import.meta.url),
);
const servicesSource = read(
  new URL("../../../src/settings/categories/services.ts", import.meta.url),
);
const headlessRoutesSource = read(new URL("../atom/headless/routes.ts", import.meta.url));
const webApiSource = read(new URL("../../../src/web/api.ts", import.meta.url));
const loginDialogSource = read(
  new URL("../../../src/components/modals/LoginDialog.vue", import.meta.url),
);
const runtimeSource = read(new URL("../../../src/runtime.ts", import.meta.url));

test("Qobuz and TIDAL account UI reuses existing Core auth actions without persisting tokens", () => {
  assert.match(servicesSource, /component: ProviderAccounts/);
  assert.match(panelSource, /qobuzCall\("auth_login", \{ user_auth_token: token \}\)/);
  assert.match(panelSource, /tidalCall\("auth_import", \{/);
  assert.match(panelSource, /access_token: accessToken/);
  assert.match(panelSource, /refresh_token: tidalRefreshToken\.value\.trim\(\) \|\| undefined/);
  assert.match(panelSource, /window\.api\.apis\.clearSession\(platform\)/);
  assert.match(panelSource, /useProviderSessionsStore\(\)/);
  assert.doesNotMatch(panelSource, /localStorage|sessionStorage|persist:/);
});

test("Headless Web provider surface exposes only Atom-managed providers", () => {
  const expected = /new Set<ApiPlatform>\(\["netease", "qobuz", "tidal"\]\)/;
  assert.match(headlessRoutesSource, expected);
  assert.match(webApiSource, expected);
  assert.doesNotMatch(headlessRoutesSource, /new Set<ApiPlatform>\(\[[^\]]*qqmusic/);
  assert.doesNotMatch(webApiSource, /new Set<ApiPlatform>\(\[[^\]]*kugou/);
});

test("Netease embedded login window is a Desktop Host capability, not a Core auth action", () => {
  assert.match(runtimeSource, /"providerLoginWindow"/);
  assert.match(loginDialogSource, /hasHostCapability\("providerLoginWindow"\)/);
  assert.match(loginDialogSource, /v-if="providerLoginWindowAvailable"/);
  assert.match(loginDialogSource, /window\.api\.apis\.openLoginWeb\("netease"\)/);
  assert.match(loginDialogSource, /openManualCookie/);
  assert.match(loginDialogSource, /startQrFlow/);
});
