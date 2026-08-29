import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertCoreProtocolCompatible,
  CORE_PROTOCOL_VERSION,
  isCoreProtocolCompatible,
} from "../../../shared/constants/coreProtocol";
import { getCoreCapabilities, getCoreInfo } from "../atom/runtime/coreInfo";

const webClientSource = readFileSync(
  new URL("../../../src/web/client.ts", import.meta.url),
  "utf8",
);
const headlessRoutesSource = readFileSync(
  new URL("../atom/headless/routes.ts", import.meta.url),
  "utf8",
);

test("Core Protocol v1 is the only currently supported Control range", () => {
  assert.equal(isCoreProtocolCompatible({ protocol: { version: CORE_PROTOCOL_VERSION } }), true);
  assert.equal(
    isCoreProtocolCompatible({ protocol: { version: CORE_PROTOCOL_VERSION + 1 } }),
    false,
  );
  assert.throws(
    () => assertCoreProtocolCompatible({ protocol: { version: CORE_PROTOCOL_VERSION + 1 } }),
    /CORE_PROTOCOL_UNSUPPORTED/,
  );
});

test("Core capability reports actual Diretta native metadata instead of a hard-coded claim", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "splayer-atom-capability-"));
  const previous = process.env.ATOM_NATIVE_DIR;
  try {
    Reflect.set(process.env, "ATOM_NATIVE_DIR", tempDir);
    assert.equal(getCoreCapabilities().diretta, false);

    mkdirSync(tempDir, { recursive: true });
    writeFileSync(path.join(tempDir, "build.json"), JSON.stringify({ diretta: true }));
    assert.equal(getCoreCapabilities().diretta, true);

    const info = getCoreInfo();
    assert.equal(info.protocol.version, CORE_PROTOCOL_VERSION);
    assert.equal(info.capabilities.diretta, true);
    assert.equal(info.capabilities.remoteOutput, false);
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, "ATOM_NATIVE_DIR");
    else Reflect.set(process.env, "ATOM_NATIVE_DIR", previous);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Headless info and Web transport enforce the shared Core Protocol contract", () => {
  assert.match(headlessRoutesSource, /c\.json\(getCoreInfo\(\)\)/);
  assert.match(webClientSource, /assertCoreProtocolCompatible\(info\)/);
  assert.match(webClientSource, /if \(path !== "\/info"\) await ensureCoreProtocolCompatible\(\)/);
  assert.match(webClientSource, /await ensureCoreProtocolCompatible\(\)/);
  assert.match(webClientSource, /coreCompatibilityError/);
});
