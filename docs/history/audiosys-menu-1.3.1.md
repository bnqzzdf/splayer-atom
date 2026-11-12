# AudioSys 菜单集成方案（SPlayer Atom 1.3.1）

> 日期：2026-11-12
>
> 状态：可行性分析与实施方案；待实现、真机验证与发布。

## 背景

AudioSys（Buildroot）根文件系统是内存盘，只有 `/audiosys`（p3）和 CONFIG 分区（p2）持久。播放器不能只装到 `/opt`，也不能依赖 systemd/OpenRC；开机后需要从持久目录恢复程序、控制命令和网页菜单入口。

参考对象：

- `.170` 上 satld-asd 1.7.33 的 x86_64 与 arm64 payload；
- satld 的 `/audiosys/satld` + `satldctl.sh` + CONFIG `networkfs.sh` 钩子 + `runners/zz_satld_ctl.json` 架构；
- 同机 ChronoSync 的 AudioSys 适配（持久二进制 + `chronosyncctl` + p2 钩子）。

## 可行性结论

可行，且不需要改音频数据面。需要新增的是安装/控制/菜单层：

- 程序与 `data/` 放在 `/audiosys/splayer-atom-core`，重启不丢；
- 用 POSIX sh 控制脚本启动 `bin/splayer-atom-core`，维护 `enable` 与 PID；
- 安装器向 CONFIG 分区 `networkfs.sh` 写入带标记的幂等钩子；
- 钩子每次开机重建 `/usr/local/bin/splayeratomctl` 软链和菜单卡片；
- 菜单卡片写入 `/opt/.gentooplayer/web/conf/runners` 或 `/opt/script-server/web/conf/runners`，分组「01. 播放设置」。

## 方案

### 新增文件

| 文件 | 作用 |
| --- | --- |
| `scripts/atom/core-system/splayeratomctl.sh` | 菜单后端：status/start/stop/restart/update |
| `scripts/atom/core-system/splayeratom-menu.sh` | 生成 `zz_splayeratom_ctl.json`，分配稳定菜单序号 |
| `scripts/atom/core-system/install-audiosys.sh` | 写 p2 钩子、建软链、注入卡片、卸载清理 |

### 安装器

- `--init audiosys` 显式选择；未指定时若检测到 `/audiosys` + `/dpdk/diretta.sh` 自动选择。
- 未显式 `--prefix` 时，AudioSys 默认安装根为 `/audiosys/splayer-atom-core`。
- `install_service` 在 AudioSys 上调用 `install-audiosys.sh install`，再由 `splayeratomctl.sh -Action start` 启动。
- `stop_service`、`uninstall`、`rollback` 走同一 ctl；卸载移除钩子、卡片与软链，保留 `data/`（除非 `--purge`）。

### 菜单卡片

- 文件名：`zz_splayeratom_ctl.json`；
- 名称：`NN. SPlayer Atom 设置`；
- 分组：`01. 播放设置`；
- 参数：动作 `status/start/stop/restart/update`，升级包 `file_upload`；
- 描述包含 Web UI 地址 `http://<LAN IP>:14558`；
- 序号优先沿用已有卡片号，其次持久序号文件 `/audiosys/.asd-cardseq/zz_splayeratom_ctl`，最后取本组最大号 +1。

### 生命周期

- `start`：置 `enable`，从持久目录启动 `bin/splayer-atom-core`，日志写 `logs/core.log`，PID 写 `/run/splayeratom.pid`。
- `stop`：摘 `enable`，SIGTERM Node 进程，等待退出；不使用 SIGKILL 作为首选。
- `restart`：保留 `enable`，stop → start。
- `update`：接受面板上传的 `splayer-atom-core-*.tar.gz`，解包后运行新包的 `install.sh --init audiosys`，保留 `data/`。
- 开机钩子：若 `enable` 存在，延迟 35 秒启动；每次开机重建软链与菜单卡片。

## 风险与控制

- CONFIG 分区写坏会导致开机钩子异常：写前备份 `networkfs.sh.bak-splayeratom-<时间戳>`，剥离旧段后 `sh -n`，失败不覆盖。
- 菜单序号冲突：沿用 satld 的稳定序号策略，写 `/audiosys/.asd-cardseq/`。
- 与 satld/hqos 的播放模式冲突：第一波不改 `ps_playmode.json`，只提供独立管理卡片；启停由用户显式操作。
- 更新包可能来自旧版本：新 `install.sh` 必须支持 `--init audiosys`；更新失败时保留旧程序与 `data/`。
- 端口冲突：默认 14558；如被占用，由 `splayeratom.conf` 的 `ATOM_SERVER_PORT` 覆盖（实现时提供）。

## 验收

1. `.170` 执行新包 `install.sh --init audiosys`；
2. 菜单出现 `NN. SPlayer Atom 设置`，位于「01. 播放设置」；
3. start/stop/restart/status 与 Web UI `/api/info` 正常；
4. 删除当前 runners 卡片后执行 p2 钩子中的 Atom 段，卡片重建；
5. 重启 `.170` 后程序、软链、卡片、`enable` 状态与 `data/` 保留；
6. `sh -n`、包闸门、`pnpm typecheck/lint/test`、文档构建通过；
7. 冻结提交、打 tag、发布 x86_64/aarch64 包。
