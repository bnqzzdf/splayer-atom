import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isCoreOwnedSettingPath, isCoreSettingPath } from "../../shared/types/settings";

const serviceSource = readFileSync(new URL("./coreSettings.ts", import.meta.url), "utf8");
const routesSource = readFileSync(new URL("../atom/headless/routes.ts", import.meta.url), "utf8");
const settingsStoreSource = readFileSync(
  new URL("../../src/stores/settings.ts", import.meta.url),
  "utf8",
);
const settingsClientSource = readFileSync(
  new URL("../../src/core/settingsClient.ts", import.meta.url),
  "utf8",
);

test("Core Settings ownership excludes Host and dedicated domain paths", () => {
  assert.equal(isCoreSettingPath("player.songLevel"), true);
  assert.equal(isCoreSettingPath("player.equalizer.enabled"), true);
  assert.equal(isCoreSettingPath("player.clippingProtection"), true);
  assert.equal(isCoreSettingPath("system.networkProxy.protocol"), true);
  assert.equal(isCoreSettingPath("download.quality"), true);
  assert.equal(isCoreSettingPath("cache.songCache.enabled"), true);
  assert.equal(isCoreSettingPath("localLyric.repoDir"), true);

  assert.equal(isCoreSettingPath("player.outputDevice"), false);
  assert.equal(isCoreSettingPath("cache.dir"), false);
  assert.equal(isCoreSettingPath("download.dir"), false);
  assert.equal(isCoreSettingPath("media.systemMediaControls"), false);
  assert.equal(isCoreSettingPath("update.channel"), false);
  assert.equal(isCoreSettingPath("externalApi.enabled"), false);
  assert.equal(isCoreSettingPath("mcp.enabled"), false);

  assert.equal(isCoreOwnedSettingPath("player.outputDevice"), true);
  assert.equal(isCoreOwnedSettingPath("library.scanDirs"), true);
  assert.equal(isCoreOwnedSettingPath("cache.dir"), true);
  assert.equal(isCoreOwnedSettingPath("download.dir"), true);
  assert.equal(isCoreOwnedSettingPath("system.onboardingCompleted"), false);
  assert.equal(isCoreOwnedSettingPath("update.channel"), false);
});

test("Web uses one explicit Core Settings snapshot and mutation contract", () => {
  assert.match(settingsClientSource, /request<CoreSettingsSnapshot>\("\/settings\/core"\)/);
  assert.match(settingsClientSource, /request\("\/settings\/core"/);
  assert.match(routesSource, /api\.get\("\/settings\/core"/);
  assert.match(routesSource, /getCoreSettingsSnapshot\(\)/);
  assert.match(settingsStoreSource, /settingsClient\.getSnapshot\(\)/);
  assert.ok(
    settingsStoreSource.indexOf("settingsClient.getSnapshot()") <
      settingsStoreSource.lastIndexOf("coreSettings as unknown as Record<string, unknown>"),
  );
  assert.match(settingsStoreSource, /if \(isCoreSettingPath\(keyPath\)\)/);
  assert.match(settingsStoreSource, /await settingsClient\.set\(keyPath, value\)/);
  assert.match(settingsStoreSource, /saveWebControlEntry\(keyPath, value\)/);
  assert.match(routesSource, /api\.post\("\/settings\/core"/);
  assert.match(routesSource, /setCoreSetting\(body\.keyPath, body\.value\)/);
});

test("Web This Control config is local and generic Core /config is not exposed", () => {
  assert.doesNotMatch(routesSource, /api\.(?:get|post)\("\/config"/);
  assert.match(settingsStoreSource, /const WEB_CONTROL_CONFIG_KEY = "splayer\/web-control-system"/);
  assert.match(settingsStoreSource, /const WEB_CONTROL_SETTING_PATHS = new Set/);
  assert.match(settingsStoreSource, /"system\.onboardingCompleted"/);
  assert.match(settingsStoreSource, /"system\.uiZoom"/);
  assert.doesNotMatch(settingsStoreSource, /agreedAgreementVersion/);
  assert.match(settingsStoreSource, /document\.documentElement\.style\.setProperty\("zoom"/);
  assert.match(settingsStoreSource, /Setting is not owned by Web Control/);
  assert.match(settingsStoreSource, /localStorage\.setItem\(WEB_CONTROL_CONFIG_KEY/);
  assert.doesNotMatch(settingsStoreSource, /request<SystemConfig>\("\/config"\)/);
});

test("Core Settings service owns its snapshot and runtime mutation side effects", () => {
  assert.match(serviceSource, /export const getCoreSettingsSnapshot/);
  assert.match(serviceSource, /player: store\.get\("player"\)/);
  assert.match(serviceSource, /library: store\.get\("library"\)/);
  assert.match(serviceSource, /networkProxy: store\.get\("system\.networkProxy"\)/);
  assert.doesNotMatch(
    serviceSource,
    /desktopLyric|dynamicIsland|taskbarLyric|externalApi|mcp|lastfm/,
  );
  assert.match(serviceSource, /store\.set\(keyPath as ConfigPath, value\)/);
  assert.match(serviceSource, /refreshPlaybackPreload\(\)/);
  assert.match(serviceSource, /setNormalizationEnabled\(value as boolean\)/);
  assert.match(serviceSource, /setClippingProtectionEnabled\(value as boolean\)/);
  assert.match(serviceSource, /setEqualizerEnabled\(value as boolean\)/);
  assert.match(serviceSource, /setEqualizerBands\(value as number\[\]\)/);
  assert.match(serviceSource, /setPreampGain\(value as number\)/);
  assert.match(serviceSource, /setFadeDuration\(/);
  assert.match(serviceSource, /SAMPLE_PROCESSING_SETTING_PATHS/);
  assert.match(serviceSource, /assertSampleProcessingAvailable\(\)/);
  assert.ok(
    serviceSource.indexOf("applySampleProcessingChange(keyPath, value)") <
      serviceSource.indexOf("store.set(keyPath as ConfigPath, value);\n    return;"),
  );
});
