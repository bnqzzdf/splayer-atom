import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CORE_NODE_RANGE,
  CORE_NODE_REFERENCE,
  assertSupportedCoreNodeRuntime,
  isSupportedCoreNodeRuntime,
} from "../atom/runtime/nodeRuntime";

const headlessRoutesSource = readFileSync(
  new URL("../atom/headless/routes.ts", import.meta.url),
  "utf8",
);

test("Core runtime policy pins Node 24.18.0 as the release reference", () => {
  assert.equal(CORE_NODE_REFERENCE, "24.18.0");
  assert.equal(CORE_NODE_RANGE, ">=24.18.0 <25");
});

test("Core accepts the supported Node 24.x range without a second-patch smoke policy", () => {
  assert.equal(isSupportedCoreNodeRuntime("24.18.0"), true);
  assert.equal(isSupportedCoreNodeRuntime("24.18.9"), true);
  assert.equal(isSupportedCoreNodeRuntime("24.99.0"), true);
  assert.equal(isSupportedCoreNodeRuntime("24.17.9"), false);
  assert.equal(isSupportedCoreNodeRuntime("23.11.0"), false);
  assert.equal(isSupportedCoreNodeRuntime("25.0.0"), false);
});

test("Core info exposes the actual Node runtime contract", () => {
  assert.match(headlessRoutesSource, /node: process\.versions\.node/);
  assert.match(headlessRoutesSource, /nodeRange: CORE_NODE_RANGE/);
  assert.match(headlessRoutesSource, /nodeReference: CORE_NODE_REFERENCE/);
});

test("Core rejects unsupported or malformed Node versions before startup", () => {
  assert.throws(() => assertSupportedCoreNodeRuntime("22.19.0"), /requires >=24\.18\.0 <25/);
  assert.throws(
    () => assertSupportedCoreNodeRuntime("invalid"),
    /Unsupported Node runtime invalid/,
  );
  assert.doesNotThrow(() => assertSupportedCoreNodeRuntime("24.18.0"));
});
