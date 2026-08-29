import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflowSource = readFileSync(
  new URL("../../../.github/workflows/core-system.yml", import.meta.url),
  "utf8",
);
const buildSource = readFileSync(
  new URL("../../../scripts/atom/build-core-system.ts", import.meta.url),
  "utf8",
);
const pluginSmokeSource = readFileSync(
  new URL("../../../scripts/atom/check-core-plugin-host.mjs", import.meta.url),
  "utf8",
);

test("Core CI pins the exact reference runtime and clean Linux x64 build environment", () => {
  assert.match(workflowSource, /runs-on: ubuntu-24\.04/);
  assert.match(workflowSource, /node-version: 24\.18\.0/);
  assert.match(workflowSource, /toolchain: 1\.98\.0/);
  assert.match(workflowSource, /pnpm install --frozen-lockfile/);
  assert.match(workflowSource, /libasound2-dev pkg-config clang/);
  assert.doesNotMatch(workflowSource, /libpipewire|libpulse/);
});

test("Core CI reuses the repository gates and does not publish a release", () => {
  assert.match(workflowSource, /run: pnpm test/);
  assert.match(workflowSource, /run: pnpm typecheck/);
  assert.match(workflowSource, /run: pnpm lint/);
  assert.match(workflowSource, /node scripts\/atom\/check-upstream-touch\.mjs/);
  assert.match(workflowSource, /pnpm exec tsx scripts\/atom\/build-core-system\.ts/);
  assert.match(workflowSource, /git diff --check/);
  assert.doesNotMatch(workflowSource, /upload-artifact|release-action|gh release|publish/);
});

test("Core artifact build performs the real plugin-host IPC smoke on the reference Node", () => {
  const coreBuild = buildSource.indexOf("vite.core.config.ts");
  const pluginSmoke = buildSource.indexOf("check-core-plugin-host.mjs");
  const stage = buildSource.indexOf("stage-core-system.ts");
  assert.ok(coreBuild >= 0 && pluginSmoke > coreBuild && stage > pluginSmoke);
  assert.match(pluginSmokeSource, /fork\(entry/);
  assert.match(pluginSmokeSource, /message\.kind === "hostReady"/);
  assert.match(pluginSmokeSource, /child\.send\(\{ kind: "ping" \}\)/);
  assert.match(pluginSmokeSource, /message\.kind === "pong"/);
});
