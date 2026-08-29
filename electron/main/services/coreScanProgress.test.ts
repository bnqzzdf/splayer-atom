import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scannerSource = readFileSync(new URL("./scanner.ts", import.meta.url), "utf8");
const compatRoutesSource = readFileSync(
  new URL("../atom/compat/routes.ts", import.meta.url),
  "utf8",
);
const webApiSource = readFileSync(new URL("../../../src/web/api.ts", import.meta.url), "utf8");

test("scanner keeps one authoritative progress snapshot beside its existing scanning state", () => {
  assert.match(scannerSource, /let currentScanProgress: ScanProgress/);
  assert.match(scannerSource, /export const getScanProgress = \(\): ScanProgress/);
  assert.match(scannerSource, /publishScanProgress\(\{\s*phase: "scanning"/s);
  assert.match(scannerSource, /publishScanProgress\(\{\s*phase: "done"/s);
  assert.match(
    scannerSource,
    /currentScanProgress = \{ \.\.\.currentScanProgress, phase: "done" \}/,
  );
});

test("Core HTTP projects the existing scanner progress without a second scan state machine", () => {
  assert.match(compatRoutesSource, /getScanProgress/);
  assert.match(
    compatRoutesSource,
    /api\.get\("\/library\/scan-progress", \(c\) => c\.json\(\{ data: getScanProgress\(\) \}\)\)/,
  );
});

test("Web scan progress consumes real total and scanned values instead of synthetic zeros", () => {
  const progressFlow =
    webApiSource.split("onScanProgress: (callback) => {")[1]?.split("const playlistApi")[0] ?? "";
  assert.match(progressFlow, /request<\{ data: ScanProgress \}>\("\/library\/scan-progress"\)/);
  assert.match(progressFlow, /callback\(progress\)/);
  assert.doesNotMatch(progressFlow, /total: 0, scanned: 0/);
  assert.doesNotMatch(progressFlow, /"\/library\/is-scanning"/);
});
