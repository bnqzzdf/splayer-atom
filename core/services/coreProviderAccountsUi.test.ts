import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (url: URL): string => readFileSync(url, "utf8");
const platformAccountSource = read(
  new URL("../../src/components/settings/custom/PlatformAccount.vue", import.meta.url),
);
const providerAccountsSource = read(
  new URL("../../src/components/settings/custom/ProviderAccounts.vue", import.meta.url),
);
const streamingLoginSource = read(
  new URL("../../src/components/modals/StreamingLoginDialog.vue", import.meta.url),
);
const settingsSchemaSource = read(new URL("../../src/settings/schema.ts", import.meta.url));
const otherSettingsSource = read(
  new URL("../../src/settings/categories/other.ts", import.meta.url),
);
const headlessRoutesSource = read(new URL("../atom/headless/routes.ts", import.meta.url));
const providerClientSource = read(new URL("../../src/core/providerClient.ts", import.meta.url));
const loginDialogSource = read(
  new URL("../../src/components/modals/LoginDialog.vue", import.meta.url),
);
const sharedApisSource = read(new URL("../../shared/types/apis.ts", import.meta.url));

test("Qobuz and TIDAL settings use one Core-owned session projection", () => {
  assert.match(settingsSchemaSource, /component: PlatformAccount/);
  assert.match(settingsSchemaSource, /componentProps: \{ platform: "qobuz" \}/);
  assert.match(settingsSchemaSource, /componentProps: \{ platform: "tidal" \}/);
  assert.match(
    settingsSchemaSource,
    /section\.id === "network" \? \[section, providerAccountsSection\] : \[section\]/,
  );

  assert.match(platformAccountSource, /useProviderSessionsStore\(\)/);
  assert.match(platformAccountSource, /providerSessions\.sessions\[props\.platform\]/);
  assert.match(platformAccountSource, /providerClient\.clearSession\(props\.platform\)/);
  assert.match(platformAccountSource, /single-platform="props\.platform"/);
  assert.doesNotMatch(
    platformAccountSource,
    /useDataStore|getPlatformAccountAdapter|localStorage|sessionStorage/,
  );

  assert.match(streamingLoginSource, /useProviderSessionsStore\(\)/);
  assert.match(streamingLoginSource, /qobuzApi\.login\(userId, token\)/);
  assert.match(streamingLoginSource, /tidalApi\.authAuthorize\(\)/);
  assert.match(streamingLoginSource, /tidalApi\.authExchange\(code, state\)/);
  assert.match(streamingLoginSource, /tidalApi\.authDeviceAuthorization/);
  assert.match(streamingLoginSource, /tidalApi\.authTokenPoll/);
  assert.match(streamingLoginSource, /providerSessions\.refresh\(\)/);
  assert.doesNotMatch(
    streamingLoginSource,
    /useStreamingAuthStore|useDataStore|localStorage|sessionStorage/,
  );

  assert.match(providerAccountsSource, /<PlatformAccount platform="qobuz" \/>/);
  assert.match(providerAccountsSource, /<PlatformAccount platform="tidal" \/>/);
  assert.doesNotMatch(
    providerAccountsSource,
    /auth_import|user_auth_token|access_token|refresh_token/,
  );
});

test("formal Settings hide frozen QQ Music and Kugou account product surfaces", () => {
  assert.doesNotMatch(otherSettingsSource, /PlatformAccount|qqmusic|kugou|kugouLoginVersion/);
  assert.doesNotMatch(otherSettingsSource, /id: "platformLogin"|id: "platformConfig"/);
  assert.doesNotMatch(settingsSchemaSource, /componentProps: \{ platform: "qqmusic" \}/);
  assert.doesNotMatch(settingsSchemaSource, /componentProps: \{ platform: "kugou" \}/);

  assert.match(sharedApisSource, /MANAGED_PROVIDER_PLATFORMS = \["netease", "qobuz", "tidal"\]/);
  assert.doesNotMatch(sharedApisSource, /MANAGED_PROVIDER_PLATFORMS = \[[^\]]*qqmusic/);
  assert.doesNotMatch(sharedApisSource, /MANAGED_PROVIDER_PLATFORMS = \[[^\]]*kugou/);
});

test("Web provider surface exposes only Atom-managed providers", () => {
  assert.match(headlessRoutesSource, /isManagedProviderPlatform\(body\?\.platform\)/);
  assert.match(providerClientSource, /ManagedProviderPlatform/);
  assert.doesNotMatch(providerClientSource, /qqmusic|kugou/);
});

test("Netease account UI uses Core QR/manual-cookie flows without a host login window", () => {
  assert.doesNotMatch(loginDialogSource, /providerLoginWindow|hasHostCapability|openLoginWeb/);
  assert.match(loginDialogSource, /openManualCookie/);
  assert.match(loginDialogSource, /neteaseQrLoginAdapter/);
  assert.match(loginDialogSource, /<QrLoginPanel/);
});
