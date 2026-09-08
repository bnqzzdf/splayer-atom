import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { songToTrack } from "./netease";

describe("netease song quality", () => {
  it("preserves the provider-reported Hi-Res sample rate instead of forcing 96 kHz", () => {
    const track = songToTrack({
      id: 1877029917,
      name: "LALISA",
      ar: [{ id: 1, name: "LISA" }],
      al: { id: 2, name: "LALISA" },
      dt: 200000,
      hr: { br: 2300000, sr: 48000 },
    } as any);

    assert.deepEqual(track.quality, {
      codec: "flac",
      sampleRate: 48000,
      bitsPerSample: 24,
      bitRate: 2300000,
      channels: 2,
    });
  });
});
