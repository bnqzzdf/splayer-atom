import assert from "node:assert/strict";
import test from "node:test";
import { coreArtifactFileName, coreArtifactSuffix } from "../../scripts/atom/core-artifact-name";

test("Node archive naming stays compatible while Bun flavors are distinct", () => {
  assert.equal(coreArtifactSuffix(false), "-system-linux-x64.tar.gz");
  assert.equal(coreArtifactSuffix(true, "v2"), "-diretta-v2-bundled-linux-x64.tar.gz");
  assert.equal(coreArtifactSuffix(false, "v2", "bun"), "-diretta-v2-bun-system-linux-x64.tar.gz");
  assert.equal(coreArtifactSuffix(true, "v2", "bun"), "-diretta-v2-bun-bundled-linux-x64.tar.gz");
  const args = [true, "1.1.3", "08138040", "20261104", "130000", "v2"] as const;
  assert.match(coreArtifactFileName(...args), /-diretta-v2-bundled-linux-x64\.tar\.gz$/);
  assert.match(coreArtifactFileName(...args, "bun"), /-diretta-v2-bun-bundled-linux-x64\.tar\.gz$/);
});
