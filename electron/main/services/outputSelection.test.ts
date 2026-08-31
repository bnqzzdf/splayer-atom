import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isDirectAlsaHardwareOutput,
  selectInitialHeadlessOutput,
} from "../../../shared/utils/outputDevice";

describe("Headless output selection", () => {
  it("accepts only canonical named ALSA hardware endpoints", () => {
    assert.equal(isDirectAlsaHardwareOutput("alsa:hw:CARD=PCH,DEV=0"), true);
    assert.equal(isDirectAlsaHardwareOutput("alsa:hw:CARD=USB_Audio,DEV=2"), true);
    assert.equal(isDirectAlsaHardwareOutput("alsa:default"), false);
    assert.equal(isDirectAlsaHardwareOutput("alsa:hw:0,0"), false);
    assert.equal(isDirectAlsaHardwareOutput("alsa:plughw:CARD=PCH,DEV=0"), false);
    assert.equal(isDirectAlsaHardwareOutput("diretta:target"), false);
  });

  it("auto-selects exactly one unique ALSA hardware endpoint", () => {
    const device = { id: "alsa:hw:CARD=PCH,DEV=0" };
    assert.equal(selectInitialHeadlessOutput([device]), device.id);
    assert.equal(selectInitialHeadlessOutput([device, device]), device.id);
  });

  it("requires a user choice for zero or multiple hardware endpoints", () => {
    assert.equal(selectInitialHeadlessOutput([{ id: "alsa:default" }]), null);
    assert.equal(
      selectInitialHeadlessOutput([
        { id: "alsa:hw:CARD=PCH,DEV=0" },
        { id: "alsa:hw:CARD=HDMI,DEV=3" },
      ]),
      null,
    );
  });
});
