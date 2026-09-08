import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDisplayQualityLevel } from "./quality";

describe("getDisplayQualityLevel", () => {
  it("treats 24-bit lossless PCM as Hi-Res without requiring a fake 96 kHz rate", () => {
    for (const sampleRate of [44100, 48000]) {
      assert.equal(
        getDisplayQualityLevel({
          codec: "flac",
          sampleRate,
          bitsPerSample: 24,
          bitRate: 0,
          channels: 2,
        }),
        "hi-res",
      );
    }
  });

  it("keeps CD-quality 44.1 kHz / 16-bit FLAC as Lossless", () => {
    assert.equal(
      getDisplayQualityLevel({
        codec: "flac",
        sampleRate: 44100,
        bitsPerSample: 16,
        bitRate: 1411200,
        channels: 2,
      }),
      "lossless",
    );
  });
});
