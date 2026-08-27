import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildQobuzSignature, buildQobuzSignaturePayload } from "./signature";

describe("Qobuz request signature", () => {
  it("sorts parameters and matches the retained track/getFileUrl signing rule", () => {
    const params = { track_id: "123", intent: "stream", format_id: "6" };
    assert.equal(
      buildQobuzSignaturePayload("track/getFileUrl", params, 1_700_000_000, "secret"),
      "trackgetFileUrlformat_id6intentstreamtrack_id1231700000000secret",
    );
    assert.equal(
      buildQobuzSignature("track/getFileUrl", params, 1_700_000_000, "secret"),
      "fac4640d8f3bec5a1ba2a90c8aa4f6fb",
    );
  });

  it("rejects endpoints without a method/action pair", () => {
    assert.throws(() => buildQobuzSignature("invalid", {}, 1, "secret"), /无效的 Qobuz endpoint/);
  });
});
