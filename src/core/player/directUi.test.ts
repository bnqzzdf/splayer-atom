import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const playerSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const playerEventsSource = readFileSync(new URL("./events.ts", import.meta.url), "utf8");
const directModeSource = readFileSync(new URL("./directMode.ts", import.meta.url), "utf8");
const sharedOutputDeviceSource = readFileSync(
  new URL("../../../shared/utils/outputDevice.ts", import.meta.url),
  "utf8",
);
const toolbarSource = readFileSync(
  new URL("../../components/player/Toolbar.vue", import.meta.url),
  "utf8",
);
const playerDataSource = readFileSync(
  new URL("../../components/player/FullPlayer/PlayerData.vue", import.meta.url),
  "utf8",
);
const webOutputSelectorSource = readFileSync(
  new URL("../../web/OutputDeviceSelector.vue", import.meta.url),
  "utf8",
);
const settingsOutputSelectorSource = readFileSync(
  new URL("../../components/settings/custom/DeviceSelector.vue", import.meta.url),
  "utf8",
);
const legacyHttpClientSource = readFileSync(
  new URL("../../services/client/httpClient.ts", import.meta.url),
  "utf8",
);
const legacyClientTypesSource = readFileSync(
  new URL("../../services/client/types.ts", import.meta.url),
  "utf8",
);
const outputDevicesSource = readFileSync(new URL("../outputDevices.ts", import.meta.url), "utf8");
const mainLayoutSource = readFileSync(
  new URL("../../layouts/MainLayout.vue", import.meta.url),
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
const aboutSettingsSource = readFileSync(
  new URL("../../components/settings/custom/AboutSettings.vue", import.meta.url),
  "utf8",
);
const fontConfigSource = readFileSync(
  new URL("../../components/settings/custom/FontConfig.vue", import.meta.url),
  "utf8",
);
const webApiSource = readFileSync(new URL("../../web/api.ts", import.meta.url), "utf8");
const downloadListSource = readFileSync(
  new URL("../../components/list/DownloadList.vue", import.meta.url),
  "utf8",
);
const copyLyricsSource = readFileSync(
  new URL("../../components/modals/CopyLyricsDialog.vue", import.meta.url),
  "utf8",
);
const windowControlsSource = readFileSync(
  new URL("../../composables/useWindowControls.ts", import.meta.url),
  "utf8",
);
const updateStoreSource = readFileSync(new URL("../../stores/update.ts", import.meta.url), "utf8");
const settingsStoreSource = readFileSync(
  new URL("../../stores/settings.ts", import.meta.url),
  "utf8",
);
const navSearchSource = readFileSync(
  new URL("../../components/layout/NavSearch.vue", import.meta.url),
  "utf8",
);
const cloudPageSource = readFileSync(new URL("../../pages/Cloud.vue", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../../main.ts", import.meta.url), "utf8");

const between = (source: string, start: string, end: string): string => {
  const afterStart = source.split(start)[1];
  assert.ok(afterStart, `missing start marker: ${start}`);
  const section = afterStart.split(end)[0];
  assert.ok(section, `missing end marker: ${end}`);
  return section;
};

test("Direct entry preflight mirrors native sample-processing requirements", () => {
  assert.match(directModeSource, /isDirettaOutput/);
  assert.match(sharedOutputDeviceSource, /startsWith\("diretta:"\)/);
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
  const commandIndex = switchFlow.indexOf("playerClient.setOutputDevice(deviceId)");
  assert.ok(preflightIndex >= 0);
  assert.ok(commandIndex > preflightIndex);
  assert.doesNotMatch(switchFlow, /prepareDirectTrackSource|materializeDirectInput|player\.stop/);
  assert.match(switchFlow, /directMode\.entryBlocked/);
});

test("Full player does not duplicate Diretta output state as a decorative badge", () => {
  assert.doesNotMatch(playerDataSource, /Diretta Target|发烧级纯净网络传输|emerald-400/);
});

test("Web status snapshots can settle a seek without high-frequency position events", () => {
  const statusProjection = between(playerEventsSource, '    case "status":', '    case "seek":');
  assert.match(statusProjection, /hasReachedSeekTarget\(event\.data\.position\)/);
  assert.match(statusProjection, /updateLyricIndex\(adjusted \+ status\.lyricOffsetMs\)/);

  const seekFlow = between(
    playerSource,
    "export const seek = async (posMs: number): Promise<void> => {",
    "/**\n * 标记一次非渲染层发起的 seek",
  );
  assert.match(seekFlow, /coreCommand\("\/seek", \{ positionMs: posMs \}\)/);
  assert.match(seekFlow, /seekTarget = null/);
  assert.match(seekFlow, /playback\.setSeeking\(false\)/);
});

test("sample-altering UI is locked for Diretta and UPnP without conflating their semantics", () => {
  assert.match(directModeSource, /isSampleProcessingUnavailableOutput/);
  assert.match(directModeSource, /selected\.value \|\| remoteSelected\.value/);
  assert.match(toolbarSource, /sampleControlsUnavailable: processingLocked/);
  assert.match(toolbarSource, /:disabled="processingLocked"/);
  assert.match(toolbarSource, /remoteOutput\.processingUnavailable/);
  assert.match(toolbarSource, /directMode\.processingUnavailable/);

  assert.match(equalizerSource, /<DirectModeNotice \/>/);
  assert.match(equalizerSource, /:disabled="directLocked"/);
  assert.match(equalizerSource, /enabled && !directLocked/);

  assert.match(speedSource, /<DirectModeNotice \/>/);
  assert.match(speedSource, /:disabled="directLocked"/);

  assert.match(settingsSource, /component: DirectModeNotice/);
  assert.match(
    settingsSource,
    /key: "fadeEnabled"[\s\S]*disabled: isSampleProcessingUnavailableSelected/,
  );
  assert.match(
    settingsSource,
    /key: "loudnessNormalization"[\s\S]*disabled: isSampleProcessingUnavailableSelected/,
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

test("Web Settings hides Desktop-only service scopes without fake facades", () => {
  assert.match(settingsSchemaSource, /isDesktopRenderer\(\) \? \[aiIntegrationCategory\] : \[\]/);
  assert.match(settingsSchemaSource, /desktopOnlyServiceSections/);
  assert.match(settingsSchemaSource, /"media", "discord", "lastfm", "externalApi"/);
  assert.match(
    settingsSchemaSource,
    /isDesktopRenderer\(\) \|\| !desktopOnlyServiceSections\.has\(section\.id\)/,
  );
  assert.match(settingsSchemaSource, /component: PlatformAccount/);
  assert.match(
    settingsSchemaSource,
    /section\.id === "network" \? \[section, providerAccountsSection\] : \[section\]/,
  );
  assert.match(fontConfigSource, /if \(externalLyricFontsAvailable\) \{/);
});

test("Settings schema centralizes Desktop shell and native-file presentation boundaries", () => {
  assert.match(runtimeSource, /"desktopUpdater"/);
  assert.match(
    settingsSchemaSource,
    /section\.id === "systemConfig"\) return hasHostCapability\("windowControls"\)/,
  );
  assert.match(
    settingsSchemaSource,
    /section\.id === "update"\) return hasHostCapability\("desktopUpdater"\)/,
  );
  assert.match(
    settingsSchemaSource,
    /section\.id === "backupReset"\) return hasHostCapability\("nativeFileDialogs"\)/,
  );
  assert.match(
    settingsSchemaSource,
    /section\.id !== "appearanceStyle" \|\| hasHostCapability\("nativeFileDialogs"\)/,
  );
  assert.doesNotMatch(webApiSource, /theme:\s*\{/);
});

test("Recognition, Cloud upload and native CJK conversion are explicit Host capabilities", () => {
  for (const capability of ["musicRecognition", "cloudUpload", "nativeCjkTransform"]) {
    assert.match(runtimeSource, new RegExp(`"${capability}"`));
  }
  assert.match(navSearchSource, /hasHostCapability\("musicRecognition"\)/);
  assert.match(navSearchSource, /v-if="recognitionAvailable"/);
  assert.match(cloudPageSource, /hasHostCapability\("cloudUpload"\)/);
  assert.match(cloudPageSource, /v-if="cloudUploadAvailable"/);
  assert.match(settingsSchemaSource, /hasHostCapability\("nativeCjkTransform"\)/);
  assert.match(settingsSchemaSource, /item\.key !== "cjkTransform"/);
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

test("Window and updater stores do not call Desktop facades from Web Control", () => {
  assert.match(windowControlsSource, /hasHostCapability\("windowControls"\)/);
  assert.match(windowControlsSource, /if \(!windowControlsAvailable\) return/);
  assert.match(updateStoreSource, /hasHostCapability\("desktopUpdater"\)/);
  assert.match(updateStoreSource, /updaterAvailable \? window\.api\.update\.onEvent/);
  assert.match(
    updateStoreSource,
    /if \(updaterAvailable\) void window\.api\.update\.check\(false\)/,
  );
  assert.match(settingsStoreSource, /if \(hasHostCapability\("desktopLyric"\)\)/);
  assert.match(settingsStoreSource, /window\.api\.window\s*\.isDesktopLyricOpen\(\)/);
});

test("Download list hides the Desktop file explorer action in Web Control", () => {
  assert.match(downloadListSource, /hasHostCapability\("hostFileExplorer"\)/);
  assert.match(downloadListSource, /v-if="canOpenDownloadLocation"/);
  assert.match(downloadListSource, /window\.api\.system\.showInExplorer/);
});

test("Lyric poster export uses the current Control host save capability", () => {
  assert.match(copyLyricsSource, /hasHostCapability\("hostFileSave"\)/);
  assert.match(copyLyricsSource, /window\.api\.system\.saveFile/);
  assert.match(copyLyricsSource, /hasHostCapability\("browserDownload"\)/);
  assert.match(copyLyricsSource, /URL\.createObjectURL\(blob\)/);
  assert.match(copyLyricsSource, /anchor\.download = fileName/);
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
  assert.match(aboutSettingsSource, /getCoreInfo\(\)/);
  const visibleEnvironment = between(
    aboutSettingsSource,
    "const envItems = computed<EnvItem[]>",
    "/** 完整诊断信息",
  );
  assert.match(visibleEnvironment, /commit\.slice\(0, 7\)/);
  assert.match(visibleEnvironment, /Core Node\.js/);
  assert.match(visibleEnvironment, /direttaSdkRelease/);
  assert.doesNotMatch(visibleEnvironment, /splayerBaseline|sourceDirty|protocol|COMMIT_DATE/);
  const copiedEnvironment = between(
    aboutSettingsSource,
    "const diagnosticItems = computed<EnvItem[]>",
    "/** 复制环境信息",
  );
  assert.match(copiedEnvironment, /info\.splayerBaseline/);
  assert.match(copiedEnvironment, /info\.protocol\.version/);
  assert.match(copiedEnvironment, /info\.sourceDirty/);
  assert.match(copiedEnvironment, /COMMIT_DATE/);
});

test("production Web mounts the shared SPlayer Control while HeadlessApp stays debug-only", () => {
  assert.match(mainSource, /if \(window\.location\.pathname === "\/debug"\)/);
  assert.match(mainSource, /await mountDebugWeb\(\)/);
  assert.match(mainSource, /await mountSPlayer\(true\)/);
  assert.match(mainSource, /document\.documentElement\.dataset\.atomRuntime = "web"/);
  assert.match(mainSource, /await installWebApi\(\)/);
  assert.match(mainSource, /import\("\.\/App\.vue"\)/);
  assert.match(mainSource, /import\("\.\/router"\)/);
  assert.match(mainSource, /await router\.replace\("\/library"\)/);
});

test("Headless Web output selector opens one grouped list with live network refresh", () => {
  assert.match(toolbarSource, /OutputDeviceSelector/);
  assert.doesNotMatch(toolbarSource, /DirettaCastPopover/);
  assert.match(outputDevicesSource, /isDirectAlsaHardwareOutput/);
  assert.match(outputDevicesSource, /startsWith\("diretta:"\)/);
  assert.match(outputDevicesSource, /startsWith\("upnp:"\)/);
  assert.doesNotMatch(webOutputSelectorSource, /<SSelect/);
  assert.match(webOutputSelectorSource, /v-for="group in groups"/);
  assert.match(webOutputSelectorSource, /kind: "alsa"/);
  assert.match(webOutputSelectorSource, /kind: "diretta"/);
  assert.match(webOutputSelectorSource, /kind: "upnp"/);
  assert.match(webOutputSelectorSource, /IconLucideRefreshCw/);
  assert.match(webOutputSelectorSource, /await refreshDevices\(\)/);
  const selectionFlow = between(
    webOutputSelectorSource,
    "const onSelect = async",
    "onMounted(() =>",
  );
  assert.match(selectionFlow, /await switchDevice\(deviceId\)/);
  assert.doesNotMatch(selectionFlow, /refreshDevices/);
  assert.doesNotMatch(webOutputSelectorSource, /SYSTEM_DEFAULT|system-default/);
});

test("Control keeps one Core-backed output transport", () => {
  assert.doesNotMatch(settingsOutputSelectorSource, /services\/client|scanDiretta/);
  assert.doesNotMatch(legacyHttpClientSource, /\/api\/v1\/diretta\//);
  assert.doesNotMatch(
    legacyClientTypesSource,
    /scanDirettaTargets|getDirettaStatus|selectDirettaTarget|getDirettaTargetInfo/,
  );
});

test("Headless Web keeps one bottom output entry available before a track is loaded", () => {
  assert.match(mainLayoutSource, /isWebRemote\(\) \|\| !!useMediaStore\(\)\.track/);
  assert.match(toolbarSource, /v-model:open="outputPopoverOpen"/);
  assert.match(toolbarSource, /status\.outputDevicesReady/);
  assert.match(toolbarSource, /status\.selectedOutputDevice === null/);
  assert.match(toolbarSource, /outputSelectionRequest/);
  assert.doesNotMatch(mainLayoutSource, /NavHeader.*OutputDeviceSelector/s);
});

test("bottom output entry shows the selected output kind and a truncated device name", () => {
  assert.match(toolbarSource, /IconLucideSpeaker/);
  assert.match(toolbarSource, /IconLucideCable/);
  assert.match(toolbarSource, /IconLucideCast/);
  assert.match(toolbarSource, /selectedOutputIcon/);
  assert.match(toolbarSource, /selectedOutputLabel/);
  assert.match(toolbarSource, /max-w-28 truncate/);
  assert.match(outputDevicesSource, /export type OutputKind = "alsa" \| "diretta" \| "upnp"/);
  assert.match(outputDevicesSource, /getOutputDisplayName/);
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
  assert.match(switchFlow, /await playerClient\.setOutputDevice\(deviceId\)/);
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
  assert.match(refreshFlow, /result\.data\.selected/);
  assert.doesNotMatch(refreshFlow, /getSelectedDeviceName/);
});

test("Control volume and tempo commands cannot bypass Diretta or UPnP processing locks", () => {
  for (const marker of [
    "export const setVolume = async",
    "export const setSpeed = async",
    "export const setPitch = async",
    "export const setPitchSync = async",
  ]) {
    const section = playerSource.split(marker)[1]?.slice(0, 420) ?? "";
    assert.match(
      section,
      /isSampleProcessingUnavailableSelected\(\)/,
      `${marker} must keep the output processing guard`,
    );
  }
});
