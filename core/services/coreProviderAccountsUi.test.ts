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
const platformLoginPanelSource = read(
  new URL("../../src/components/modals/PlatformLoginPanel.vue", import.meta.url),
);
const loginPlatformRegistrySource = read(
  new URL("../../src/apis/login/platform.ts", import.meta.url),
);
const navUserSource = read(new URL("../../src/components/layout/NavUser.vue", import.meta.url));
const qobuzApiSource = read(new URL("../apis/qobuz/index.ts", import.meta.url));
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
  // 粘贴 token 作为浏览器授权的备用入口，无需再填写 user_id。
  assert.ok(streamingLoginSource.includes("copy(localStorage.getItem('qobuz_user_auth_token'))"));
  assert.doesNotMatch(streamingLoginSource, /Query String Parameters 中复制 user_id/);
  // 一键 OAuth：主按钮走原生本地回调，粘贴 token 降级为兜底，两条路都在
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
    /MANAGED_PROVIDER_PLATFORMS = \[\s*"netease",\s*"qqmusic",\s*"kugou",\s*"qobuz",\s*"tidal",?\s*\]/,
  );
});

test("Web provider surface exposes only Atom-managed providers", () => {
  assert.match(headlessRoutesSource, /isManagedProviderPlatform\(body\?\.platform\)/);
  assert.match(providerClientSource, /ManagedProviderPlatform/);
  assert.doesNotMatch(providerClientSource, /qqmusic|kugou/);
});

test("Netease account UI uses Core QR/manual-cookie flows without a host login window", () => {
  // 网易的登录面板（扫码 + 手动 Cookie）现在是 PlatformLoginPanel，弹窗与设置行共用同一套流程
  assert.doesNotMatch(
    platformLoginPanelSource,
    /providerLoginWindow|hasHostCapability|openLoginWeb/,
  );
  assert.match(platformLoginPanelSource, /cookieOpen/);
  assert.match(platformLoginPanelSource, /<QrLoginPanel/);
  assert.match(platformLoginPanelSource, /<LoginCookieDialog/);
  // 扫码适配器由注册表按平台取，网易只在注册表里出现一次
  assert.match(platformLoginPanelSource, /getPlatformAccountAdapter\(props\.platform\)/);
  assert.match(loginPlatformRegistrySource, /netease: \{/);
  assert.match(loginPlatformRegistrySource, /qrLogin: neteaseQrLoginAdapter/);
  assert.doesNotMatch(platformLoginPanelSource, /neteaseApi\.login_qr/);
});

test("全部五个平台只有一个登录入口：统一的带页签弹窗", () => {
  // 设置页：网易云与其余四个平台在同一张表里，缺一行就会让「在线平台账号」看起来漏了网易
  for (const platform of ["netease", "qqmusic", "kugou", "qobuz", "tidal"]) {
    assert.match(
      settingsSchemaSource,
      new RegExp(`componentProps: \\{ platform: "${platform}" \\}`),
      `设置页缺少 ${platform} 账号行`,
    );
  }
  assert.match(settingsSchemaSource, /key: "neteaseAccount"/);

  // 弹窗覆盖全部五个平台：页签由 ALL_PLATFORMS 生成，不再只认 qobuz/tidal
  assert.match(
    streamingLoginSource,
    /ALL_PLATFORMS\.map\(\(p\) => \(\{ key: p, label: PLATFORM_TAB_LABELS\[p\] \}\)\)/,
  );
  assert.match(
    streamingLoginSource,
    /import PlatformLoginPanel from "@\/components\/modals\/PlatformLoginPanel\.vue"/,
  );
  for (const slot of ["netease", "qqmusic", "kugou", "qobuz", "tidal"]) {
    assert.match(streamingLoginSource, new RegExp(`<template #${slot}>`), `弹窗缺少 ${slot} 页签`);
  }
  assert.doesNotMatch(streamingLoginSource, /tab\?: "qobuz" \| "tidal"/);

  // header 的头像按钮就是这个入口：未登录点开弹窗，已登录也能从账号气泡进去
  assert.match(navUserSource, /<StreamingLoginDialog v-model:open="loginOpen"/);
  assert.doesNotMatch(navUserSource, /<LoginDialog/);
  assert.match(navUserSource, /login\.managePlatforms/);
});

test("Qobuz 登出不把远端吊销放在关键路径上", () => {
  // 远端 user/logout 的返回值在原生侧就是 `let _ =`（丢弃），失败也不影响登出；
  // 但 Reqwest 客户端超时 30s，实测一次往返约 0.6s —— 本地凭据清除却只要毫秒级。
  // 所以顺序必须是「先清本地，远端丢后台」，否则断开连接按钮会一直转圈。
  const logoutBlock = qobuzApiSource.slice(qobuzApiSource.indexOf("const authLogout"));
  assert.ok(logoutBlock.includes("clearQobuzAuth()"), "authLogout 必须清本地凭据");
  // 不再 await 原生调用：出现 await callStreamingNative(...auth_logout...) 就是退化回去了
  assert.doesNotMatch(
    qobuzApiSource,
    /await callStreamingNative\(\s*"qobuz",\s*"auth_logout"/,
    "远端吊销不能 await 在登出路径上",
  );
  assert.match(
    logoutBlock,
    /void callStreamingNative\("qobuz", "auth_logout", auth, \{\}\)\.catch/,
  );
  // nativeAuth() 取的是即将被删掉的 token，必须在清本地之前取
  assert.ok(
    logoutBlock.indexOf("const auth = nativeAuth()") < logoutBlock.indexOf("clearQobuzAuth()"),
    "auth 必须在 clearQobuzAuth() 之前取，否则远端吊销拿不到 token",
  );
  assert.match(qobuzApiSource, /const authLogout = async \(\): Promise<unknown> => \{/);
});

test("断开连接按钮不等多余的会话刷新才复位", () => {
  const disconnectBlock = platformAccountSource.slice(
    platformAccountSource.indexOf("const disconnect"),
  );
  assert.ok(disconnectBlock.includes("providerClient.clearSession(props.platform)"));
  // 会话投影由 Core 推送（providerSessions 事件），getSessions 只是兜底：
  // 一旦写成 `await refreshSession()` 就会把按钮复位推迟一次往返
  assert.doesNotMatch(
    platformAccountSource,
    /await refreshSession\(\);\s*\n\s*toast\.success\(t\("settings\.platformLogin\.toast\.logoutDone"/,
    "disconnect 不应 await refreshSession 才提示成功",
  );
  assert.match(disconnectBlock, /void refreshSession\(\);/);
});
