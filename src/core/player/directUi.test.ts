import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (url: URL): string => readFileSync(url, "utf8");

const playerSource = read(new URL("./index.ts", import.meta.url));
const eventsSource = read(new URL("./events.ts", import.meta.url));
const directModeSource = read(new URL("./directMode.ts", import.meta.url));
const outputDeviceSource = read(new URL("../../../shared/utils/outputDevice.ts", import.meta.url));
const toolbarSource = read(new URL("../../components/player/Toolbar.vue", import.meta.url));
const outputSelectorSource = read(new URL("../../web/OutputDeviceSelector.vue", import.meta.url));
const mainLayoutSource = read(new URL("../../layouts/MainLayout.vue", import.meta.url));
const equalizerSource = read(
  new URL("../../components/modals/EqualizerDialog.vue", import.meta.url),
);
const speedSource = read(new URL("../../components/modals/SpeedDialog.vue", import.meta.url));
const playerSettingsSource = read(new URL("../../settings/categories/player.ts", import.meta.url));
const mainSource = read(new URL("../../main.ts", import.meta.url));

const between = (source: string, start: string, end: string): string => {
  const tail = source.split(start)[1];
  assert.ok(tail, `missing start marker: ${start}`);
  return tail.split(end)[0] ?? "";
};

test("saved processed settings stay dormant instead of blocking Direct entry", () => {
  assert.match(directModeSource, /isDirettaOutput/);
  assert.match(outputDeviceSource, /startsWith\("diretta:"\)/);
  assert.doesNotMatch(directModeSource, /DirectEntryBlocker|getCurrentDirectEntryBlockers/);
  assert.doesNotMatch(playerSource, /getCurrentDirectEntryBlockers|directMode\.entryBlocked/);
});

test("Diretta output selection sends one Core command without a dormant-settings preflight", () => {
  const switchFlow = between(
    playerSource,
    "export const switchDevice = async (",
    "/**\n * 设置队列并从指定位置开始播放",
  );
  const command = switchFlow.indexOf("playerClient.setOutputDevice(deviceId)");
  assert.ok(command >= 0);
  assert.doesNotMatch(switchFlow, /getCurrentDirectEntryBlockers|entryBlocked/);
  assert.doesNotMatch(switchFlow, /materializeDirectInput|prepareDirectTrackSource|window\.api/);
});

test("sample-altering UI is locked for Direct ALSA, Diretta, and UPnP", () => {
  assert.match(directModeSource, /isAlsaDirectOutput/);
  assert.match(directModeSource, /isUpnpOutput/);
  assert.match(directModeSource, /isDirectOutputSelected/);
  assert.match(directModeSource, /settings\.system\.player\.alsaPlaybackMode/);
  assert.match(toolbarSource, /sampleControlsUnavailable: processingLocked/);
  assert.match(toolbarSource, /:disabled="processingLocked"/);
  assert.match(toolbarSource, /key: "equalizer"[\s\S]*disabled: processingLocked\.value/);
  assert.match(toolbarSource, /key: "speed"[\s\S]*disabled: processingLocked\.value/);
  assert.match(equalizerSource, /<DirectModeNotice \/>/);
  assert.match(equalizerSource, /:disabled="directLocked"/);
  assert.match(speedSource, /<DirectModeNotice \/>/);
  assert.match(speedSource, /:disabled="directLocked"/);
  assert.match(playerSettingsSource, /component: DirectModeNotice/);
  assert.match(
    playerSettingsSource,
    /key: "loudnessNormalization"[\s\S]*disabled: isSampleProcessingUnavailableSelected/,
  );
  assert.match(
    playerSettingsSource,
    /key: "clippingProtection"[\s\S]*disabled: isSampleProcessingUnavailableSelected/,
  );
});

test("Web status snapshots settle seeks without owning playback lifecycle", () => {
  const statusProjection = between(eventsSource, '    case "status":', '    case "seek":');
  assert.match(statusProjection, /hasReachedSeekTarget\(event\.data\.position\)/);
  assert.match(statusProjection, /updateLyricIndex\(adjusted \+ status\.lyricOffsetMs\)/);
  assert.doesNotMatch(eventsSource, /directTrackBoundary|sourceError/);
});

test("Web Control exposes one grouped Core-backed output selector", () => {
  assert.match(toolbarSource, /OutputDeviceSelector/);
  assert.match(outputSelectorSource, /v-for="group in groups"/);
  assert.match(outputSelectorSource, /kind: "alsa"/);
  assert.match(outputSelectorSource, /kind: "diretta"/);
  assert.match(outputSelectorSource, /kind: "upnp"/);
  assert.match(
    outputSelectorSource,
    /\.filter\(\(group\) => group\.kind !== "diretta" \|\| group\.devices\.length > 0\)/,
  );
  assert.match(outputSelectorSource, /await refreshDevices\(\)/);
  assert.match(outputSelectorSource, /await switchDevice\(deviceId\)/);
  assert.match(outputSelectorSource, /AlsaPlaybackModeSelector/);
  assert.match(outputSelectorSource, /selectedOutputDevice\?\.startsWith\('alsa:hw:'\)/);
  assert.doesNotMatch(outputSelectorSource, /services\/client|scanDiretta|window\.api/);
  // 该弹层在全屏播放器里是封面玻璃弹层（SPopover cover：bg-black/55 恒为暗底）。
  // 设备列表必须跟着 cover 用封面色——否则浅色主题下 text-on-surface 接近纯黑，
  // 落在暗玻璃上就看不见了（真实反馈：跟随系统 + 暗背景时输出设备选择看不清）。
  assert.match(toolbarSource, /<OutputDeviceSelector :cover="cover"/);
  assert.match(outputSelectorSource, /:class="sectionLabelClass"/);
  assert.match(
    outputSelectorSource,
    /:class="itemClass\(device\.id === status\.selectedOutputDevice\)"/,
  );
  assert.match(outputSelectorSource, /<AlsaPlaybackModeSelector :cover="props\.cover" \/>/);
});

test("ALSA mode is changed only through the Core mode command", () => {
  assert.match(playerSource, /export const switchAlsaPlaybackMode = async/);
  assert.match(playerSource, /playerClient\.setAlsaPlaybackMode\(mode\)/);
  assert.match(playerSource, /settings\.system\.player\.alsaPlaybackMode = mode/);
  assert.doesNotMatch(playerSource, /setAlsaPlaybackMode\([^)]*window\.api/);
});

test("Web player bar stays available before a track is loaded", () => {
  assert.match(mainLayoutSource, /showPlayerBar = computed\(\(\) => true\)/);
  assert.match(toolbarSource, /v-model:open="outputPopoverOpen"/);
  assert.match(toolbarSource, /status\.outputDevicesReady/);
  assert.match(toolbarSource, /status\.selectedOutputDevice === null/);
});

test("Web renderer has no Desktop runtime or Host capability branch", () => {
  for (const source of [mainSource, mainLayoutSource, toolbarSource, outputSelectorSource]) {
    assert.doesNotMatch(
      source,
      /hasHostCapability|isWebRemote|ipcRenderer|electron\/preload|atomRuntime/,
    );
  }
  assert.doesNotMatch(mainSource, /installWebApi|web\/api/);
  assert.match(mainSource, /await useSettingsStore\(\)\.syncSystem\(\)/);
  assert.match(mainSource, /import\("\.\/App\.vue"\)/);
  assert.doesNotMatch(mainSource, /router\.replace\("\/library"\)/);
});

test("Control volume and tempo commands cannot bypass output processing locks", () => {
  for (const marker of [
    "export const setVolume = async",
    "export const setSpeed = async",
    "export const setPitch = async",
    "export const setPitchSync = async",
  ]) {
    const section = playerSource.split(marker)[1]?.slice(0, 420) ?? "";
    assert.match(section, /isSampleProcessingUnavailableSelected\(\)/);
  }
});
