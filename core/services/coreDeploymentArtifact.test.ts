import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const installerUrl = new URL("../../scripts/atom/core-system/install-systemd.sh", import.meta.url);
const installerSource = readFileSync(installerUrl, "utf8");
const serviceSource = readFileSync(
  new URL("../../scripts/atom/core-system/splayer-atom-core.service", import.meta.url),
  "utf8",
);
const stageSource = readFileSync(
  new URL("../../scripts/atom/stage-core-system.ts", import.meta.url),
  "utf8",
);
// 根 locale 的部署文档是中文；英文原文在 docs/en/ 下。
// 安全规则两份都要有，所以两条都断言。
const deploymentSource = readFileSync(
  new URL("../../docs/core-deployment.md", import.meta.url),
  "utf8",
);
const deploymentEnSource = readFileSync(
  new URL("../../docs/en/core-deployment.md", import.meta.url),
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
  // 中文版（站点与 GitHub 的默认文档）
  assert.match(deploymentSource, /不要把新发布产物直接解包覆盖正在使用的安装/);
  assert.match(deploymentSource, /不要让旧二进制去读新安装里可能已被迁移的 `data\/`/);
  assert.match(deploymentSource, /绝不要把「删掉数据库再重新扫描」当作/);
  // 规则里的路径与 SQLite 备份方式不因语言变化
  for (const source of [deploymentSource, deploymentEnSource]) {
    assert.match(source, /splayer-atom-core\.rollback/);
    assert.match(source, /cp -a \/opt\/splayer-atom-core\.rollback\/data/);
    assert.match(source, /data\/backups\/migration-\*/);
    assert.match(source, /VACUUM INTO/);
  }
  // 英文副本必须保留同一条规则的英文表述
  assert.match(deploymentEnSource, /Do not unpack a new release over the active installation/);
  assert.match(
    deploymentEnSource,
    /do not run the previous binary against the new installation's possibly migrated `data\/`/i,
  );
  assert.match(deploymentEnSource, /Never use "delete the database and rescan"/);
});
