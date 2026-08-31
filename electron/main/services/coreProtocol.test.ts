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

const controlClientSource = readFileSync(
  new URL("../../../src/core/controlClient.ts", import.meta.url),
  "utf8",
);
const eventClientSource = readFileSync(
  new URL("../../../src/core/controlEventClient.ts", import.meta.url),
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

test("product version differences do not override Core Protocol compatibility", () => {
  const olderProduct = { version: "0.1.0", protocol: { version: CORE_PROTOCOL_VERSION } };
  const newerProduct = { version: "9.9.9", protocol: { version: CORE_PROTOCOL_VERSION } };
  assert.equal(isCoreProtocolCompatible(olderProduct), true);
  assert.equal(isCoreProtocolCompatible(newerProduct), true);
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
    assert.equal(info.capabilities.download, true);
    assert.equal(info.capabilities.diretta, true);
    assert.equal(info.capabilities.remoteOutput, false);
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, "ATOM_NATIVE_DIR");
    else Reflect.set(process.env, "ATOM_NATIVE_DIR", previous);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Core info projects packaged Atom release identity independently from protocol compatibility", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "splayer-atom-release-info-"));
  const previousResources = process.env.ATOM_RESOURCES_DIR;
  const previousVersion = process.env.ATOM_APP_VERSION;
  const previousCommit = process.env.ATOM_COMMIT;
  const previousSourceDirty = process.env.ATOM_SOURCE_DIRTY;
  const previousBaseline = process.env.ATOM_SPLAYER_BASELINE;
  const previousNative = process.env.ATOM_NATIVE_DIR;
  try {
    const nativeDir = path.join(tempDir, "native");
    mkdirSync(nativeDir);
    writeFileSync(
      path.join(nativeDir, "build.json"),
      JSON.stringify({ diretta: true, direttaSdkRelease: 150 }),
    );
    writeFileSync(
      path.join(tempDir, "runtime.json"),
      JSON.stringify({
        atomVersion: "1.2.3",
        atomCommit: "atom-commit",
        sourceDirty: true,
        splayerBaseline: "splayer-baseline",
        direttaSdkRelease: 150,
      }),
    );
    Reflect.set(process.env, "ATOM_RESOURCES_DIR", tempDir);
    Reflect.set(process.env, "ATOM_NATIVE_DIR", nativeDir);
    Reflect.deleteProperty(process.env, "ATOM_APP_VERSION");
    Reflect.deleteProperty(process.env, "ATOM_COMMIT");
    Reflect.deleteProperty(process.env, "ATOM_SOURCE_DIRTY");
    Reflect.deleteProperty(process.env, "ATOM_SPLAYER_BASELINE");

    const info = getCoreInfo();
    assert.equal(info.version, "1.2.3");
    assert.equal(info.commit, "atom-commit");
    assert.equal(info.sourceDirty, true);
    assert.equal(info.splayerBaseline, "splayer-baseline");
    assert.equal(info.direttaSdkRelease, 150);
    assert.equal(info.protocol.version, CORE_PROTOCOL_VERSION);
  } finally {
    const restore = (name: string, value: string | undefined): void => {
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else Reflect.set(process.env, name, value);
    };
    restore("ATOM_RESOURCES_DIR", previousResources);
    restore("ATOM_APP_VERSION", previousVersion);
    restore("ATOM_COMMIT", previousCommit);
    restore("ATOM_SOURCE_DIRTY", previousSourceDirty);
    restore("ATOM_SPLAYER_BASELINE", previousBaseline);
    restore("ATOM_NATIVE_DIR", previousNative);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Headless info and Web transport enforce the shared Core Protocol contract", () => {
  assert.match(headlessRoutesSource, /c\.json\(getCoreInfo\(\)\)/);
  assert.match(controlClientSource, /assertCoreProtocolCompatible\(info\)/);
  assert.match(
    controlClientSource,
    /if \(path !== "\/info"\) await ensureCoreProtocolCompatible\(\)/,
  );
  assert.match(eventClientSource, /await ensureCoreProtocolCompatible\(\)/);
  assert.match(eventClientSource, /coreCompatibilityError/);
});
