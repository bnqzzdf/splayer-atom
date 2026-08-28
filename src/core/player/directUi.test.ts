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

test("Direct device selection refuses incompatible state before stopping or materializing audio", () => {
  const switchFlow = between(
    playerSource,
    "export const switchDevice = async (",
    "/**\n * 设置队列并从指定位置开始播放",
  );
  const preflightIndex = switchFlow.indexOf("getCurrentDirectEntryBlockers().length > 0");
  const materializeIndex = switchFlow.indexOf("prepareDirectTrackSource(");
  const stopIndex = switchFlow.indexOf("window.api.player.stop()");
  assert.ok(preflightIndex >= 0);
  assert.ok(materializeIndex > preflightIndex);
  assert.ok(stopIndex > preflightIndex);
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

test("Headless Web output selector only exposes real ALSA hardware and Diretta", () => {
  assert.match(toolbarSource, /OutputDeviceSelector/);
  assert.match(webOutputSelectorSource, /startsWith\("diretta:"\)/);
  assert.match(webOutputSelectorSource, /alsa:hw:CARD=/);
  assert.match(webOutputSelectorSource, /ALSA ·/);
  assert.doesNotMatch(webOutputSelectorSource, /SYSTEM_DEFAULT|system-default/);
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
