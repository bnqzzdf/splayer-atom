import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTidalDashManifest } from "./dash";

const mpd = (media: string, repeat = "2"): string => `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
  <Period>
    <AdaptationSet contentType="audio" mimeType="audio/mp4">
      <Representation id="FLAC_HIRES,96000,24" codecs="flac" audioSamplingRate="96000">
        <SegmentTemplate
          initialization="https://audio.invalid/init.mp4?token=x"
          media="${media}"
          startNumber="7">
          <SegmentTimeline>
            <S d="380928" r="${repeat}" />
            <S d="128210" />
          </SegmentTimeline>
        </SegmentTemplate>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

describe("parseTidalDashManifest", () => {
  it("extracts initialization and ordered numbered media segments", () => {
    const parsed = parseTidalDashManifest(mpd("https://audio.invalid/$Number$.mp4?token=x"));

    assert.equal(parsed.initializationUrl, "https://audio.invalid/init.mp4?token=x");
    assert.equal(parsed.codec, "flac");
    assert.equal(parsed.sampleRate, 96_000);
    assert.deepEqual(parsed.mediaUrls, [
      "https://audio.invalid/7.mp4?token=x",
      "https://audio.invalid/8.mp4?token=x",
      "https://audio.invalid/9.mp4?token=x",
      "https://audio.invalid/10.mp4?token=x",
    ]);
  });

  it("supports zero-padded Number templates", () => {
    const parsed = parseTidalDashManifest(
      mpd("https://audio.invalid/segment-$Number%05d$.mp4", "0"),
    );
    assert.deepEqual(parsed.mediaUrls, [
      "https://audio.invalid/segment-00007.mp4",
      "https://audio.invalid/segment-00008.mp4",
    ]);
  });

  it("rejects unsupported or unbounded templates instead of guessing", () => {
    assert.throws(
      () => parseTidalDashManifest(mpd("https://audio.invalid/$Time$.mp4")),
      /\$Time\$/,
    );
    assert.throws(
      () => parseTidalDashManifest(mpd("https://audio.invalid/$Number$.mp4", "-1")),
      /数值无效/,
    );
  });
});
