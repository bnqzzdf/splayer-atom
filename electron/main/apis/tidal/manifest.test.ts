import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTidalPlaybackManifest } from "./manifest";

describe("parseTidalPlaybackManifest", () => {
  it("extracts the first URL from a base64 JSON/BTS manifest", () => {
    const manifest = Buffer.from(
      JSON.stringify({ urls: ["https://audio.invalid/track.flac"], codecs: "flac" }),
      "utf8",
    ).toString("base64");

    assert.deepEqual(
      parseTidalPlaybackManifest({
        manifestMimeType: "application/vnd.tidal.bts",
        manifest,
      }),
      {
        kind: "url",
        url: "https://audio.invalid/track.flac",
        mimeType: undefined,
        codec: "flac",
      },
    );
  });

  it("recognizes a base64 DASH MPD without pretending it is a direct URL", () => {
    const xml = '<MPD><Representation codecs="flac"><SegmentTemplate media="segment-$Number$.m4s" /></Representation></MPD>';
    const parsed = parseTidalPlaybackManifest({
      manifestMimeType: "application/dash+xml",
      manifest: Buffer.from(xml, "utf8").toString("base64"),
    });

    assert.equal(parsed?.kind, "dash");
    if (parsed?.kind === "dash") {
      assert.equal(parsed.xml, xml);
      assert.equal(parsed.codec, "flac");
    }
  });

  it("returns null for an unrecognized manifest", () => {
    assert.equal(parseTidalPlaybackManifest({ manifest: "not-a-manifest" }), null);
  });
});
