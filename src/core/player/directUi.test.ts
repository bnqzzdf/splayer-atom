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

test("Direct entry preflight mirrors native sample-processing requirements", () => {
  assert.match(directModeSource, /isDirettaOutput/);
  assert.match(outputDeviceSource, /startsWith\("diretta:"\)/);
  assert.match(directModeSource, /state\.volume - 1/);
  assert.match(directModeSource, /state\.normalizationEnabled/);
  assert.match(directModeSource, /state\.equalizerEnabled/);
  assert.match(directModeSource, /state\.speed - 1/);
  assert.match(directModeSource, /state\.pitch !== 0/);
  assert.doesNotMatch(directModeSource, /fadeEnabled|fadeDuration/);
});

test("Diretta output selection validates Control state before the Core command", () => {
  const switchFlow = between(
    playerSource,
    "export const switchDevice = async (",
    "/**\n * 设置队列并从指定位置开始播放",
  );
  const preflight = switchFlow.indexOf("getCurrentDirectEntryBlockers().length > 0");
  const command = switchFlow.indexOf("playerClient.setOutputDevice(deviceId)");
  assert.ok(preflight >= 0);
  assert.ok(command > preflight);
  assert.match(switchFlow, /directMode\.entryBlocked/);
  assert.doesNotMatch(switchFlow, /materializeDirectInput|prepareDirectTrackSource|window\.api/);
});

test("sample-altering UI is locked for Diretta and UPnP", () => {
  assert.match(directModeSource, /isSampleProcessingUnavailableOutput/);
  assert.match(toolbarSource, /sampleControlsUnavailable: processingLocked/);
  assert.match(toolbarSource, /:disabled="processingLocked"/);
  assert.match(equalizerSource, /<DirectModeNotice \/>/);
  assert.match(equalizerSource, /:disabled="directLocked"/);
  assert.match(speedSource, /<DirectModeNotice \/>/);
  assert.match(speedSource, /:disabled="directLocked"/);
  assert.match(playerSettingsSource, /component: DirectModeNotice/);
  assert.match(
    playerSettingsSource,
    /key: "loudnessNormalization"[\s\S]*disabled: isSampleProcessingUnavailableSelected/,
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
  assert.doesNotMatch(outputSelectorSource, /services\/client|scanDiretta|window\.api/);
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
  assert.match(mainSource, /await router\.replace\("\/library"\)/);
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
