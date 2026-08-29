import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getHeadlessServerPort } from "../runtime";

const environmentSource = readFileSync(
  new URL("../atom/runtime/environment.ts", import.meta.url),
  "utf8",
);
const coreEntrySource = readFileSync(new URL("../core-node/index.ts", import.meta.url), "utf8");
const pathsSource = readFileSync(new URL("../utils/paths.ts", import.meta.url), "utf8");
const loggerSource = readFileSync(new URL("../utils/logger.ts", import.meta.url), "utf8");
const engineSource = readFileSync(new URL("./engine.ts", import.meta.url), "utf8");
const stageSource = readFileSync(
  new URL("../../../scripts/atom/stage-core-system.ts", import.meta.url),
  "utf8",
);

test("Core production keeps durable data beside the staged application", () => {
  assert.match(coreEntrySource, /ATOM_DATA_DIR.*\.\.\/data/);
  assert.match(pathsSource, /runtimeEnvironment\.dataDir \?\?/);
  assert.match(stageSource, /outputDir, "data"/);
});

test("Core cache defaults to the Linux XDG cache tree without changing Desktop defaults", () => {
  assert.match(coreEntrySource, /ATOM_CACHE_DIR \?\?= runtimeEnvironment\.defaultCoreCacheDir/);
  assert.match(environmentSource, /XDG_CACHE_HOME/);
  assert.match(environmentSource, /\.cache/);
  assert.match(environmentSource, /"splayer-atom"/);
  assert.match(pathsSource, /runtimeEnvironment\.cacheDir \?\? path\.join\(dataRoot, "cache"\)/);
});

test("Core deployment can override the Headless listen port without changing defaults", () => {
  const previousPort = process.env.ATOM_SERVER_PORT;
  const previousRendererUrl = process.env.ELECTRON_RENDERER_URL;
  try {
    Reflect.deleteProperty(process.env, "ATOM_SERVER_PORT");
    Reflect.deleteProperty(process.env, "ELECTRON_RENDERER_URL");
    assert.equal(getHeadlessServerPort(), 14558);
    Reflect.set(process.env, "ATOM_SERVER_PORT", "24680");
    assert.equal(getHeadlessServerPort(), 24680);
    Reflect.set(process.env, "ATOM_SERVER_PORT", "70000");
    assert.equal(getHeadlessServerPort(), 14558);
  } finally {
    if (previousPort === undefined) Reflect.deleteProperty(process.env, "ATOM_SERVER_PORT");
    else Reflect.set(process.env, "ATOM_SERVER_PORT", previousPort);
    if (previousRendererUrl === undefined) {
      Reflect.deleteProperty(process.env, "ELECTRON_RENDERER_URL");
    } else {
      Reflect.set(process.env, "ELECTRON_RENDERER_URL", previousRendererUrl);
    }
  }
});

test("Core uses stdout stderr logging while Desktop keeps file logging", () => {
  assert.match(coreEntrySource, /ATOM_LOG_STDIO_ONLY \?\?= "1"/);
  assert.match(loggerSource, /runtimeEnvironment\.stdioOnlyLogs/);
  assert.match(loggerSource, /log\.transports\.file\.level = false/);
  assert.match(loggerSource, /"日志输出: stdout\/stderr"/);
  assert.match(engineSource, /!runtimeEnvironment\.stdioOnlyLogs/);
  assert.match(engineSource, /audioEngine\.initLogger\(nativeLogsDir, isDev\)/);
});
