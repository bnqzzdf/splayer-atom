import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CORE_NODE_RANGE,
  CORE_NODE_REFERENCE,
  assertSupportedCoreNodeRuntime,
  isSupportedCoreNodeRuntime,
} from "../atom/runtime/nodeRuntime";

const coreInfoSource = readFileSync(
  new URL("../atom/runtime/coreInfo.ts", import.meta.url),
  "utf8",
);

test("Core runtime policy pins Node 24.18.0 as the release reference", () => {
  assert.equal(CORE_NODE_REFERENCE, "24.18.0");
  assert.equal(CORE_NODE_RANGE, ">=22.19.0");
});

test("Core accepts Node 22.19 and newer while keeping a separate release reference", () => {
  assert.equal(isSupportedCoreNodeRuntime("22.19.0"), true);
  assert.equal(isSupportedCoreNodeRuntime("22.19.9"), true);
  assert.equal(isSupportedCoreNodeRuntime("22.20.0"), true);
  assert.equal(isSupportedCoreNodeRuntime("23.11.0"), true);
  assert.equal(isSupportedCoreNodeRuntime("24.18.0"), true);
  assert.equal(isSupportedCoreNodeRuntime("25.0.0"), true);
  assert.equal(isSupportedCoreNodeRuntime("22.18.9"), false);
  assert.equal(isSupportedCoreNodeRuntime("21.99.0"), false);
});

test("Core info exposes the actual Node runtime contract", () => {
  assert.match(coreInfoSource, /node: process\.versions\.node/);
  assert.match(coreInfoSource, /nodeRange: CORE_NODE_RANGE/);
  assert.match(coreInfoSource, /nodeReference: CORE_NODE_REFERENCE/);
  assert.match(coreInfoSource, /protocol: \{ version: CORE_PROTOCOL_VERSION \}/);
  assert.match(coreInfoSource, /capabilities: getCoreCapabilities\(\)/);
});

test("Core rejects unsupported or malformed Node versions before startup", () => {
  assert.throws(() => assertSupportedCoreNodeRuntime("22.18.9"), /requires >=22\.19\.0/);
  assert.throws(
    () => assertSupportedCoreNodeRuntime("invalid"),
    /Unsupported Node runtime invalid/,
  );
  assert.doesNotThrow(() => assertSupportedCoreNodeRuntime("22.19.0"));
  assert.doesNotThrow(() => assertSupportedCoreNodeRuntime("24.18.0"));
});
