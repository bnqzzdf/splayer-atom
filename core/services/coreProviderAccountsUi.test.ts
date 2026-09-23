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
  assert.match(
    platformAccountSource,
    /:single-platform="props\.platform === 'tidal' \? 'tidal' : 'qobuz'"/,
  );
  assert.match(platformAccountSource, /getPlatformAccountAdapter\(props\.platform\)/);
  assert.ok(streamingLoginSource.includes("copy(localStorage.getItem('qobuz_user_auth_token'))"));

  assert.match(streamingLoginSource, /useProviderSessionsStore\(\)/);
  assert.match(streamingLoginSource, /qobuzApi\.login\(userId, token\)/);
  // 2026-09 起 Qobuz 只支持粘贴 token：界面不再要求 user_id，并给出 Console 一行命令
  assert.ok(streamingLoginSource.includes("copy(localStorage.getItem('qobuz_user_auth_token'))"));
  assert.doesNotMatch(streamingLoginSource, /Query String Parameters 中复制 user_id/);
  // 一键 OAuth：主按钮走原生本地回调，粘贴 token 降级为兜底，两条路都在
  // oauthStart 必须带上浏览器所在 host：设备无图形浏览器，回调地址得是设备可达地址
  assert.match(streamingLoginSource, /qobuzApi\.oauthStart\(window\.location\.hostname\)/);
  assert.match(streamingLoginSource, /qobuzApi\.oauthAwait\(\)/);
  assert.match(streamingLoginSource, /用浏览器登录 Qobuz/);
  assert.match(streamingLoginSource, /openExternal\(start\.url\)/);
  assert.match(streamingLoginSource, /tidalApi\.authAuthorize\(\)/);
  assert.match(streamingLoginSource, /tidalApi\.authExchange\(code, state\)/);
  assert.match(streamingLoginSource, /tidalApi\.authDeviceAuthorization/);
  assert.match(streamingLoginSource, /tidalApi\.authTokenPoll/);
  assert.match(streamingLoginSource, /providerSessions\.refresh\(\)/);
  assert.doesNotMatch(streamingLoginSource, /useStreamingAuthStore|useDataStore|sessionStorage/);
  // 渲染端不得自己读写登录态存储（凭证由 Core 持有）。
  // 唯一允许出现 localStorage 的地方是 Qobuz 取值提示里的那行 Console 命令——
  // 它是给用户在浏览器控制台执行的文本，不是本组件的访问。
  const storageLines = streamingLoginSource
    .split("\n")
    .filter((line) => line.includes("localStorage"))
    .filter((line) => !line.includes("copy(localStorage"));
  assert.equal(
    storageLines.length,
    0,
    `渲染端不应直接访问 localStorage，命中：\n${storageLines.join("\n")}`,
  );

  assert.match(providerAccountsSource, /<PlatformAccount platform="qobuz" \/>/);
  assert.match(providerAccountsSource, /<PlatformAccount platform="tidal" \/>/);
  assert.doesNotMatch(
    providerAccountsSource,
    /auth_import|user_auth_token|access_token|refresh_token/,
  );
});

test("formal Settings expose QQ Music and Kugou account rows on the provider surface", () => {
  assert.doesNotMatch(otherSettingsSource, /PlatformAccount|qqmusic|kugou|kugouLoginVersion/);
  assert.doesNotMatch(otherSettingsSource, /id: "platformLogin"|id: "platformConfig"/);

  // QM / KG 走账号式行（Cookie + 扫码），与 Qobuz / TIDAL 的托管式行共用同一个 PlatformAccount。
  assert.match(settingsSchemaSource, /componentProps: \{ platform: "qqmusic" \}/);
  assert.match(settingsSchemaSource, /componentProps: \{ platform: "kugou" \}/);
  assert.match(settingsSchemaSource, /key: "qqmusicAccount"/);
  assert.match(settingsSchemaSource, /key: "kugouAccount"/);

  assert.match(
    sharedApisSource,
    /MANAGED_PROVIDER_PLATFORMS = \["netease", "qqmusic", "kugou", "qobuz", "tidal"\]/,
  );
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
