import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getCoreServerPort } from "../runtime";

const environmentSource = readFileSync(
  new URL("../atom/runtime/environment.ts", import.meta.url),
  "utf8",
);
const coreEntrySource = readFileSync(new URL("../core-node/index.ts", import.meta.url), "utf8");
const pathsSource = readFileSync(new URL("../utils/paths.ts", import.meta.url), "utf8");
const loggerSource = readFileSync(new URL("../utils/logger.ts", import.meta.url), "utf8");
const stageSource = readFileSync(
  new URL("../../scripts/atom/stage-core-system.ts", import.meta.url),
  "utf8",
);

test("Core production keeps durable data beside the staged application", () => {
  assert.match(coreEntrySource, /ATOM_DATA_DIR.*\.\.\/data/);
  assert.match(pathsSource, /runtimeEnvironment\.dataDir \?\?/);
  assert.match(stageSource, /outputDir, "data"/);
});

test("Core cache defaults to the Linux XDG cache tree", () => {
  assert.match(coreEntrySource, /ATOM_CACHE_DIR \?\?= runtimeEnvironment\.defaultCoreCacheDir/);
  assert.match(environmentSource, /XDG_CACHE_HOME/);
  assert.match(environmentSource, /\.cache/);
  assert.match(environmentSource, /"splayer-atom"/);
  assert.match(pathsSource, /runtimeEnvironment\.cacheDir \?\? path\.join\(dataRoot, "cache"\)/);
});

test("Core deployment can override the listen port without changing defaults", () => {
  const previousPort = process.env.ATOM_SERVER_PORT;
  try {
    Reflect.deleteProperty(process.env, "ATOM_SERVER_PORT");
    assert.equal(getCoreServerPort(), 14558);
    Reflect.set(process.env, "ATOM_SERVER_PORT", "24680");
    assert.equal(getCoreServerPort(), 24680);
    Reflect.set(process.env, "ATOM_SERVER_PORT", "70000");
    assert.equal(getCoreServerPort(), 14558);
  } finally {
    if (previousPort === undefined) Reflect.deleteProperty(process.env, "ATOM_SERVER_PORT");
    else Reflect.set(process.env, "ATOM_SERVER_PORT", previousPort);
  }
});

test("Core uses stdout stderr logging", () => {
  assert.match(coreEntrySource, /ATOM_LOG_STDIO_ONLY \?\?= "1"/);
  assert.match(loggerSource, /systemd\/journald/);
  assert.doesNotMatch(loggerSource, /electron-log/);
  assert.match(loggerSource, /console\[method\]/);
  assert.doesNotMatch(loggerSource, /createWriteStream|appendFile|logPath/);
});

test("Bundled Core WebSocket uses the built-in JavaScript validation path", () => {
  assert.match(coreEntrySource, /WS_NO_BUFFER_UTIL \?\?= "1"/);
  assert.match(coreEntrySource, /WS_NO_UTF_8_VALIDATE \?\?= "1"/);
  const serverImport = coreEntrySource.indexOf('import("@main/server")');
  assert.ok(coreEntrySource.indexOf("WS_NO_BUFFER_UTIL") < serverImport);
});
