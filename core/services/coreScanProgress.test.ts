import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scannerSource = readFileSync(new URL("./scanner.ts", import.meta.url), "utf8");
const compatRoutesSource = readFileSync(
  new URL("../atom/compat/routes.ts", import.meta.url),
  "utf8",
);
const libraryStoreSource = readFileSync(
  new URL("../../src/stores/library.ts", import.meta.url),
  "utf8",
);

test("scanner keeps one authoritative progress snapshot beside its existing scanning state", () => {
  assert.match(scannerSource, /let currentScanProgress: ScanProgress/);
  assert.match(scannerSource, /export const getScanProgress = \(\): ScanProgress/);
  assert.match(scannerSource, /publishScanProgress\(\{\s*phase: "scanning"/s);
  assert.match(scannerSource, /publishScanProgress\(\{\s*phase: "done"/s);
  assert.match(
    scannerSource,
    /publishCoreControlEvent\(\{ type: "libraryScanProgress", data: progress \}\)/,
  );
  assert.match(
    scannerSource,
    /publishScanProgress\(\{ \.\.\.currentScanProgress, phase: "done" \}\)/,
  );
});

test("Core HTTP projects the existing scanner progress without a second scan state machine", () => {
  assert.match(compatRoutesSource, /getScanProgress/);
  assert.match(
    compatRoutesSource,
    /api\.get\("\/library\/scan-progress", \(c\) => c\.json\(\{ data: getScanProgress\(\) \}\)\)/,
  );
});

test("Controls consume scanner progress through the shared Core event envelope", () => {
  assert.match(
    libraryStoreSource,
    /subscribeCoreControlEvent\("libraryScanProgress", \(data\) => \{/,
  );
  assert.match(libraryStoreSource, /scanProgress\.value = data/);
  assert.doesNotMatch(libraryStoreSource, /window\.api\.library\.onScanProgress/);
});
