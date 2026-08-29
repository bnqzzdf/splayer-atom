import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const installerUrl = new URL(
  "../../../scripts/atom/core-system/install-systemd.sh",
  import.meta.url,
);
const installerSource = readFileSync(installerUrl, "utf8");
const serviceSource = readFileSync(
  new URL("../../../scripts/atom/core-system/splayer-atom-core.service", import.meta.url),
  "utf8",
);
const stageSource = readFileSync(
  new URL("../../../scripts/atom/stage-core-system.ts", import.meta.url),
  "utf8",
);
const deploymentSource = readFileSync(
  new URL("../../../docs/core-deployment.md", import.meta.url),
  "utf8",
);

test("Core systemd installer has valid shell syntax and requires an explicit privilege mode", () => {
  const syntax = spawnSync("sh", ["-n", installerUrl.pathname], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
  assert.match(installerSource, /--diretta/);
  assert.match(installerSource, /--user <service-user>/);
  assert.match(installerSource, /\$\(id -u\).* -ne 0/);
  assert.match(installerSource, /service user does not exist/);
  assert.match(installerSource, /systemctl daemon-reload/);
  assert.doesNotMatch(installerSource, /^systemctl enable/m);
  assert.doesNotMatch(installerSource, /^systemctl start/m);
});

test("Core systemd installer binds the unit to the actual extracted installation root", () => {
  assert.match(serviceSource, /# @ATOM_SERVICE_USER@/);
  assert.match(serviceSource, /WorkingDirectory=\/opt\/splayer-atom-core/);
  assert.match(serviceSource, /ExecStart=\/opt\/splayer-atom-core\/bin\/splayer-atom-core/);
  assert.match(installerSource, /WorkingDirectory=\/opt\/splayer-atom-core/);
  assert.match(installerSource, /ExecStart=\/opt\/splayer-atom-core\/bin\/splayer-atom-core/);
  assert.match(installerSource, /# @ATOM_SERVICE_USER@/);
});

test("Core system artifact stages the deployment helper and operator guide", () => {
  assert.match(stageSource, /core-system", "install-systemd\.sh"/);
  assert.match(stageSource, /service", "install-systemd\.sh"/);
  assert.match(
    stageSource,
    /chmodSync\(path\.join\(outputDir, "service", "install-systemd\.sh"\), 0o755\)/,
  );
  assert.match(stageSource, /docs", "core-deployment\.md"/);
});

test("Core deployment guide keeps rollback data independent from migrated data", () => {
  assert.match(deploymentSource, /Do not unpack a new release over the active installation/);
  assert.match(deploymentSource, /splayer-atom-core\.rollback/);
  assert.match(deploymentSource, /cp -a \/opt\/splayer-atom-core\.rollback\/data/);
  assert.match(
    deploymentSource,
    /do not run the previous binary against the new installation's possibly migrated `data\/`/i,
  );
  assert.match(deploymentSource, /data\/backups\/migration-\*/);
  assert.match(deploymentSource, /Never use "delete the database and rescan"/);
});
