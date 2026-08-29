import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const playerSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const directModeSource = readFileSync(new URL("./directMode.ts", import.meta.url), "utf8");
const toolbarSource = readFileSync(
  new URL("../../components/player/Toolbar.vue", import.meta.url),
  "utf8",
);
const webOutputSelectorSource = readFileSync(
  new URL("../../web/OutputDeviceSelector.vue", import.meta.url),
  "utf8",
);
const equalizerSource = readFileSync(
  new URL("../../components/modals/EqualizerDialog.vue", import.meta.url),
  "utf8",
);
const speedSource = readFileSync(
  new URL("../../components/modals/SpeedDialog.vue", import.meta.url),
  "utf8",
);
const settingsSource = readFileSync(
  new URL("../../settings/categories/player.ts", import.meta.url),
  "utf8",
);
const runtimeSource = readFileSync(new URL("../../runtime.ts", import.meta.url), "utf8");
const settingsSchemaSource = readFileSync(
  new URL("../../settings/schema.ts", import.meta.url),
  "utf8",
);
const settingsDialogSource = readFileSync(
  new URL("../../settings/useSettingsDialog.ts", import.meta.url),
  "utf8",
);
const generalSettingsSource = readFileSync(
  new URL("../../settings/categories/general.ts", import.meta.url),
  "utf8",
);
const appearanceSettingsSource = readFileSync(
  new URL("../../settings/categories/appearance.ts", import.meta.url),
  "utf8",
);
const aboutSettingsSource = readFileSync(
  new URL("../../components/settings/custom/AboutSettings.vue", import.meta.url),
  "utf8",
);
const fontConfigSource = readFileSync(
  new URL("../../components/settings/custom/FontConfig.vue", import.meta.url),
  "utf8",
);
const webApiSource = readFileSync(new URL("../../web/api.ts", import.meta.url), "utf8");

const between = (source: string, start: string, end: string): string => {
  const afterStart = source.split(start)[1];
  assert.ok(afterStart, `missing start marker: ${start}`);
  const section = afterStart.split(end)[0];
  assert.ok(section, `missing end marker: ${end}`);
  return section;
};

test("Direct entry preflight mirrors native sample-processing requirements", () => {
  assert.match(directModeSource, /startsWith\("diretta:"\)/);
  assert.match(directModeSource, /state\.volume - 1/);
  assert.match(directModeSource, /state\.normalizationEnabled/);
  assert.match(directModeSource, /state\.equalizerEnabled/);
  assert.match(directModeSource, /state\.speed - 1/);
  assert.match(directModeSource, /state\.pitch !== 0/);
  assert.doesNotMatch(directModeSource, /fadeEnabled|fadeDuration/);
});

test("Direct device selection refuses incompatible state before sending the Core command", () => {
  const switchFlow = between(
    playerSource,
    "export const switchDevice = async (",
    "/**\n * 设置队列并从指定位置开始播放",
  );
  const preflightIndex = switchFlow.indexOf("getCurrentDirectEntryBlockers().length > 0");
  const commandIndex = switchFlow.indexOf("window.api.player.setOutputDevice(deviceId)");
  assert.ok(preflightIndex >= 0);
  assert.ok(commandIndex > preflightIndex);
  assert.doesNotMatch(switchFlow, /prepareDirectTrackSource|materializeDirectInput|player\.stop/);
  assert.match(switchFlow, /directMode\.entryBlocked/);
});

test("Existing sample-altering UI is visibly locked while Diretta is selected", () => {
  assert.match(toolbarSource, /sampleControlsUnavailable: directLocked/);
  assert.match(toolbarSource, /:disabled="directLocked"/);
  assert.match(toolbarSource, /directMode\.processingUnavailable/);

  assert.match(equalizerSource, /<DirectModeNotice \/>/);
  assert.match(equalizerSource, /:disabled="directLocked"/);
  assert.match(equalizerSource, /enabled && !directLocked/);

  assert.match(speedSource, /<DirectModeNotice \/>/);
  assert.match(speedSource, /:disabled="directLocked"/);

  assert.match(settingsSource, /component: DirectModeNotice/);
  assert.match(settingsSource, /key: "fadeEnabled"[\s\S]*disabled: isDirectOutputSelected/);
  assert.match(
    settingsSource,
    /key: "loudnessNormalization"[\s\S]*disabled: isDirectOutputSelected/,
  );
});

test("Desktop-only toolbar actions use explicit Host capability instead of Web branching", () => {
  assert.match(runtimeSource, /export type ControlHostCapability/);
  assert.match(runtimeSource, /"desktopLyric"/);
  assert.match(runtimeSource, /export const hasHostCapability/);
  assert.match(toolbarSource, /hasHostCapability\("desktopLyric"\)/);
  assert.match(toolbarSource, /v-if="desktopLyricAvailable"/);
  assert.doesNotMatch(toolbarSource, /v-if="!webRemote"/);
});

test("Host-only Settings categories follow Control capabilities", () => {
  assert.match(settingsSchemaSource, /hasHostCapability\("desktopLyric"\)/);
  assert.match(settingsSchemaSource, /\[externalLyricCategory\]/);
  assert.match(settingsSchemaSource, /hasHostCapability\("globalHotkeys"\)/);
  assert.match(settingsSchemaSource, /\[hotkeysCategory\]/);
  assert.match(settingsDialogSource, /settingsSchema\.some\(\(item\) => item\.id === requested\)/);
  assert.match(settingsDialogSource, /: settingsSchema\[0\]\.id/);
});

test("General Settings hides Desktop shell, updater and file-dialog surfaces by Host capability", () => {
  assert.match(runtimeSource, /"desktopUpdater"/);
  assert.match(
    generalSettingsSource,
    /hasHostCapability\("windowControls"\) \? \[systemConfigSection\]/,
  );
  assert.match(generalSettingsSource, /hasHostCapability\("desktopUpdater"\) \? \[updateSection\]/);
  assert.match(
    generalSettingsSource,
    /hasHostCapability\("nativeFileDialogs"\) \? \[backupResetSection\]/,
  );
});

test("Appearance hides Desktop-managed background images without native file dialogs", () => {
  assert.match(
    appearanceSettingsSource,
    /key: "appearanceStyle"[\s\S]*visible: \(\) => hasHostCapability\("nativeFileDialogs"\)/,
  );
  assert.doesNotMatch(webApiSource, /theme:\s*\{/);
});

test("Font settings do not pretend Web can enumerate Desktop system fonts", () => {
  assert.match(runtimeSource, /"systemFonts"/);
  assert.match(fontConfigSource, /hasHostCapability\("systemFonts"\)/);
  assert.match(fontConfigSource, /hasHostCapability\("desktopLyric"\)/);
  assert.match(fontConfigSource, /systemFontEnumerationAvailable \? "select" : "custom"/);
  assert.match(
    fontConfigSource,
    /GROUP_ORDER\.filter\(\(group\) => group !== "externalLyric" \|\| externalLyricFontsAvailable\)/,
  );
  assert.match(fontConfigSource, /if \(systemFontEnumerationAvailable\) void ensureLoaded\(\)/);
});

test("About Settings does not require an Electron facade in Web Control", () => {
  assert.match(runtimeSource, /"hostLogDirectory"/);
  assert.match(aboutSettingsSource, /hasHostCapability\("desktopUpdater"\)/);
  assert.match(aboutSettingsSource, /hasHostCapability\("hostLogDirectory"\)/);
  assert.match(
    aboutSettingsSource,
    /isDesktopRenderer\(\) \? window\.electron\.process\.versions : null/,
  );
  assert.match(aboutSettingsSource, /v-if="updaterAvailable"/);
  assert.match(aboutSettingsSource, /v-if="logDirectoryAvailable"/);
  assert.match(webApiSource, /request<CoreInfo>\("\/info"\)/);
  assert.match(webApiSource, /osInfo: \{ type: info\.platform, arch: info\.arch, release: "" \}/);
});

test("Headless Web output selector only exposes real ALSA hardware and Diretta", () => {
  assert.match(toolbarSource, /OutputDeviceSelector/);
  assert.match(webOutputSelectorSource, /startsWith\("diretta:"\)/);
  assert.match(webOutputSelectorSource, /alsa:hw:CARD=/);
  assert.match(webOutputSelectorSource, /ALSA ·/);
  assert.match(webOutputSelectorSource, /await switchDevice/);
  assert.match(webOutputSelectorSource, /await refreshDevices/);
  assert.doesNotMatch(webOutputSelectorSource, /SYSTEM_DEFAULT|system-default/);
});

test("shared Control output switch reports online Source Direct preparation", () => {
  const switchFlow = between(
    playerSource,
    "export const switchDevice = async (",
    "/**\n * 设置队列并从指定位置开始播放",
  );
  assert.match(switchFlow, /const track = useMediaStore\(\)\.track/);
  assert.match(
    switchFlow,
    /isDirettaOutput\(deviceId\) && track !== null && track\.source !== "local"/,
  );
  assert.match(switchFlow, /toast\.loading\(i18n\.global\.t\("directMode\.preparingSource"\)/);
  assert.match(switchFlow, /duration: 0/);
  assert.match(switchFlow, /preparingToast\?\.close\(\)/);
  assert.match(switchFlow, /await window\.api\.player\.setOutputDevice\(deviceId\)/);
  assert.doesNotMatch(switchFlow, /materializeDirectInput|prepareDirectTrackSource/);
});

test("Controls refresh output preference from Core config authority", () => {
  const refreshFlow = between(
    playerSource,
    "export const refreshDevices = async",
    "/**\n * 切换音频输出设备",
  );
  assert.match(refreshFlow, /await settings\.syncSystem\(\)/);
  assert.match(refreshFlow, /settings\.system\.player\.outputDevice/);
  assert.doesNotMatch(refreshFlow, /getSelectedDeviceName/);
});

test("Core volume and tempo controls cannot bypass the Direct UI lock", () => {
  for (const marker of [
    "export const setVolume = async",
    "export const setSpeed = async",
    "export const setPitch = async",
    "export const setPitchSync = async",
  ]) {
    const section = playerSource.split(marker)[1]?.slice(0, 420) ?? "";
    assert.match(section, /isDirectOutputSelected\(\)/, `${marker} must keep the Direct guard`);
  }
});
