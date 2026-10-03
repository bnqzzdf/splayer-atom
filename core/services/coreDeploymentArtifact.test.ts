import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const installerUrl = new URL("../../scripts/atom/core-system/install-systemd.sh", import.meta.url);
const installerSource = readFileSync(installerUrl, "utf8");
const openrcInstallerUrl = new URL(
  "../../scripts/atom/core-system/install-openrc.sh",
  import.meta.url,
);
const openrcInstallerSource = readFileSync(openrcInstallerUrl, "utf8");
const openrcServiceSource = readFileSync(
  new URL("../../scripts/atom/core-system/splayer-atom-core.openrc", import.meta.url),
  "utf8",
);
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

test("Core OpenRC installer has valid shell syntax, needs root, and refuses non-OpenRC hosts", () => {
  const syntax = spawnSync("sh", ["-n", openrcInstallerUrl.pathname], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
  assert.match(openrcInstallerSource, /--diretta/);
  assert.match(openrcInstallerSource, /--user <service-user>/);
  assert.match(openrcInstallerSource, /\$\(id -u\).* -ne 0/);
  assert.match(openrcInstallerSource, /service user does not exist/);
  // OpenRC 目标机判据，并在 systemd 主机上明确劝退
  assert.match(openrcInstallerSource, /\/sbin\/openrc-run/);
  assert.match(openrcInstallerSource, /install-systemd\.sh on systemd hosts/);
  // 与 install-systemd.sh 一致：只安装定义，不替操作者启动或设开机自启
  assert.doesNotMatch(openrcInstallerSource, /^rc-update add/m);
  assert.doesNotMatch(openrcInstallerSource, /^rc-service .* start/m);
});

test("Core OpenRC installer binds the service to the actual extracted root and keeps user conf.d lines", () => {
  assert.match(
    openrcInstallerSource,
    /INIT_SOURCE="\$ROOT_DIR\/service\/splayer-atom-core\.openrc"/,
  );
  assert.match(openrcInstallerSource, /INIT_TARGET="\/etc\/init\.d\/splayer-atom-core"/);
  assert.match(openrcInstallerSource, /CONF_TARGET="\/etc\/conf\.d\/splayer-atom-core"/);
  assert.match(openrcInstallerSource, /install -m 0755 "\$INIT_SOURCE" "\$INIT_TARGET"/);
  assert.match(openrcInstallerSource, /SPLAYER_ATOM_ROOT=\\"\$ROOT_DIR\\"/);
  assert.match(openrcInstallerSource, /command_user=\\"\$SERVICE_USER\\"/);
  // 重新安装时保留用户在 conf.d 里自己加的行
  assert.match(
    openrcInstallerSource,
    /grep -v -E '\^\[\[:space:\]\]\*\(SPLAYER_ATOM_ROOT\|command_user\)='/,
  );
});

test("Core OpenRC service script matches the systemd unit and bounds restarts", () => {
  // 同一启动器、同一工作目录：OpenRC 侧的默认安装根与 unit 里的路径一致
  assert.match(openrcServiceSource, /^#!\/sbin\/openrc-run$/m);
  assert.match(openrcServiceSource, /: "\$\{SPLAYER_ATOM_ROOT:=\/opt\/splayer-atom-core\}"/);
  assert.match(openrcServiceSource, /command="\$\{SPLAYER_ATOM_ROOT\}\/bin\/splayer-atom-core"/);
  assert.match(openrcServiceSource, /directory="\$\{SPLAYER_ATOM_ROOT\}"/);
  assert.match(serviceSource, /WorkingDirectory=\/opt\/splayer-atom-core/);
  assert.match(serviceSource, /ExecStart=\/opt\/splayer-atom-core\/bin\/splayer-atom-core/);
  // 守护与日志
  assert.match(openrcServiceSource, /supervisor="supervise-daemon"/);
  assert.match(openrcServiceSource, /pidfile="\/run\/\$\{RC_SVCNAME\}\.pid"/);
  assert.match(openrcServiceSource, /output_log="\/var\/log\/\$\{RC_SVCNAME\}\.log"/);
  assert.match(openrcServiceSource, /error_log="\/var\/log\/\$\{RC_SVCNAME\}\.err\.log"/);
  assert.match(openrcServiceSource, /depend\(\) \{\s*need net/s);
  // conf.d 先被 source，所以每个可调项都必须走 `:=` 默认值，否则 conf.d 覆盖不了
  for (const name of ["respawn_delay", "respawn_period", "respawn_max", "retry"]) {
    assert.match(openrcServiceSource, new RegExp(`: "\\$\\{${name}:=[^}]+\\}"`));
  }
  // 有界重启：respawn_max 不能是 0（无限重启会把崩溃环藏成 status=started）
  const number = (name: string): number => {
    const matched = new RegExp(`: "\\$\\{${name}:=([0-9]+)\\}\\"`).exec(openrcServiceSource);
    assert.ok(matched, `missing default for ${name}`);
    return Number(matched[1]);
  };
  const delay = number("respawn_delay");
  const period = number("respawn_period");
  const max = number("respawn_max");
  assert.ok(max > 0, "respawn_max must be bounded");
  assert.ok(
    period >= delay * max,
    `respawn_period (${period}) must be >= respawn_delay (${delay}) × respawn_max (${max})`,
  );
  // 停止走 TERM→KILL；实时权限用 start_pre 的 ulimit 表达（等价 LimitMEMLOCK）
  assert.match(openrcServiceSource, /retry:=\TERM\/[0-9]+\/KILL\/[0-9]+/);
  assert.match(openrcServiceSource, /ulimit -l unlimited/);
});

test("Core system artifact stages the OpenRC service script and installer", () => {
  assert.match(stageSource, /core-system", "splayer-atom-core\.openrc"/);
  assert.match(stageSource, /service", "splayer-atom-core\.openrc"/);
  assert.match(
    stageSource,
    /chmodSync\(path\.join\(outputDir, "service", "splayer-atom-core\.openrc"\), 0o755\)/,
  );
  assert.match(stageSource, /core-system", "install-openrc\.sh"/);
  assert.match(stageSource, /service", "install-openrc\.sh"/);
  assert.match(
    stageSource,
    /chmodSync\(path\.join\(outputDir, "service", "install-openrc\.sh"\), 0o755\)/,
  );
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
