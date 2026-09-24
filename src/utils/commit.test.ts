import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SHORT_COMMIT_LENGTH, shortCommit } from "./commit";

describe("shortCommit", () => {
  it("keeps the artifact naming convention of 8 characters", () => {
    assert.equal(SHORT_COMMIT_LENGTH, 8);
    assert.equal(shortCommit("47c71df62dc3ab9b8968286cfda414870fdcea7e"), "47c71df6");
  });

  it("matches the short commit used in the bundled artifact file name", () => {
    // splayer-atom-core-1.1.1-47c71df6-20260924-101404-bundled-linux-x64.tar.gz
    const artifactName =
      "splayer-atom-core-1.1.1-47c71df6-20260924-101404-bundled-linux-x64.tar.gz";
    const fromArtifact = artifactName.split("-")[4];
    assert.equal(shortCommit("47c71df62dc3ab9b8968286cfda414870fdcea7e"), fromArtifact);
  });

  it("normalizes casing and surrounding whitespace", () => {
    assert.equal(shortCommit("  47C71DF62DC3AB9B8968286CFDA414870FDCEA7E\n"), "47c71df6");
  });

  it("never truncates an unknown placeholder or invent characters", () => {
    assert.equal(shortCommit("unknown"), "unknown");
    assert.equal(shortCommit(""), "");
    // 短于约定长度时原样返回，避免把 7 位补成 8 位这种伪造身份。
    assert.equal(shortCommit("47c71df"), "47c71df");
  });
});
