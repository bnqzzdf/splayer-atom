# GentooPlayer（OpenRC）服务管理

> 最后更新：2026-10-20

GentooPlayer（下称 GP）是 Core 的主要落地形态之一，但它是**纯 OpenRC** 系统：没有 systemd，
`service/install-systemd.sh` 与本文档站里的 systemd 步骤在 GP 上都不适用。本页给出在 GP 上
开发、部署、升级与日常服务管理的完整做法，内容以真机实测为准（基线：GentooPlayerX86 v373 x86-64，
OpenRC `0.63.3`，`splayer-atom-core` 1.1.3）。

与 systemd 相同的部分（产物布局、`data/` 是权威持久状态、目录级回滚原则）见
[Core 部署与升级](./core-deployment.md)；本页只讲差异与 OpenRC 侧的做法。

## 目标机形态（实测基线）

| 项        | 实测值                                                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------------------------------- |
| init 系统 | OpenRC `0.63.3 (Gentoo Linux)`；`/sbin/{openrc,openrc-run,rc-service,rc-update,supervise-daemon}`                      |
| systemd   | **不存在**：无 `systemctl`，无 `/run/systemd` ⇒ 产物自带的 systemd 单元与安装脚本不可用                                |
| 服务脚本  | `/etc/init.d/` 175 个；其中 172 个用 `#!/sbin/openrc-run`，17 个用 `supervise-daemon`                                  |
| 参数覆盖  | `/etc/conf.d/` 67 个文件                                                                                               |
| 运行级    | `sysinit` / `boot` / `default` / `shutdown`；`/etc/runlevels/<级>/<服务>` 都是指向 `/etc/init.d/<服务>` 的**符号链接** |
| 面板集成  | 菜单「05. 启用/禁用软件」+ Web 面板 `:8889`（`service_manager.py`）+「0. 软件网页」卡片                                |

运行级里有一批 GP 自带的**一次性服务**：`trim`、`clockup`、`gpkernel1`、`gphavagedstop`、
`gp_starter`、`gpchronystop`、`gpsetrestart`、`gprtclock`。它们开机做完自己的事就
`rc-service $RC_SVCNAME stop`，因此在 `rc-status default` 里显示 `[stopped]` 是**正常现象**，
不代表开机没跑。判断一个服务是否常驻，要看它是不是 `supervise-daemon`/自管守护型。

## OpenRC 与 systemd 对照

| 概念         | systemd                                    | OpenRC（GP）                                                                         |
| ------------ | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| 服务定义     | `/etc/systemd/system/<x>.service`          | `/etc/init.d/<x>`（`#!/sbin/openrc-run`）                                            |
| 参数覆盖     | unit 里的 `Environment=`                   | `/etc/conf.d/<x>`（启动前被 source，可覆盖脚本变量）                                 |
| 开机自启     | `systemctl enable <x>`                     | `rc-update add <x> default`（在 `/etc/runlevels/default/` 建软链）                   |
| 启停重启     | `systemctl start/stop/restart <x>`         | `rc-service <x> start/stop/restart`                                                  |
| 状态         | `systemctl status <x>`                     | `rc-service <x> status`（退出码 **0=started，3=stopped**）                           |
| 自启查询     | `systemctl is-enabled <x>`                 | `rc-update show -v \| grep <x>`、或看 `/etc/runlevels/*/<x>`                         |
| 依赖顺序     | `After=` / `Wants=`                        | `depend() { need / use / after / before / want }`                                    |
| 守护与重启   | `Restart=on-failure` + `RestartSec=`       | `supervisor="supervise-daemon"` + `respawn_delay` / `respawn_max` / `respawn_period` |
| 运行用户     | `User=` / `Group=`                         | `command_user=` / `supervisor` 的 user 参数（GP 上默认 root）                        |
| 资源限制     | `LimitMEMLOCK=infinity` / `LimitRTPRIO=95` | `start_pre()` 里 `ulimit -l unlimited` / `ulimit -r 95`                              |
| 日志         | `journalctl -u <x>`                        | `output_log` / `error_log`（惯例 `/var/log/<x>.log`、`<x>.err.log`）                 |
| 全部服务状态 | `systemctl list-units`                     | `rc-status --servicelist --nocolor`                                                  |
| 状态复位     | `systemctl reset-failed <x>`               | `rc-service <x> zap`（手工复位为 stopped）                                           |

## 开发：写一个 GP 上能用的服务脚本

### 推荐骨架

产物里自带的 `service/splayer-atom-core.openrc` 就是下面这个骨架（`install-openrc.sh` 按原样
安装，不做 sed 改写），因此本节同时是「读懂产物脚本」和「自己写 GP 服务」的说明：

```sh
#!/sbin/openrc-run
name="splayer-atom-core"
description="SPlayer Atom Core"

command="/opt/splayer-atom-core/bin/splayer-atom-core"
directory="/opt/splayer-atom-core"
supervisor="supervise-daemon"
pidfile="/run/${RC_SVCNAME}.pid"
output_log="/var/log/${RC_SVCNAME}.log"
error_log="/var/log/${RC_SVCNAME}.err.log"

# 有界重启：respawn_period 必须 >= respawn_delay × respawn_max，
# 否则 supervise-daemon 会报错并退化成无限重启。
respawn_delay=5
respawn_period=120
respawn_max=10

# 停止：先 SIGTERM，超时再 SIGKILL
retry="TERM/5/KILL/5"

depend() {
    need net
    after localmount
}

start_pre() {
    # Diretta Host / ALSA 需要锁定内存实时权限，等价于 systemd 的 LimitMEMLOCK=infinity
    ulimit -l unlimited 2>/dev/null || true
    # ALSA 输出写线程切 SCHED_FIFO，等价于 systemd 的 LimitRTPRIO=95
    ulimit -r 95 2>/dev/null || true
}
```

### 要点（每条都对应一次实测）

1. **首行必须是 `#!/sbin/openrc-run`**。用 `/bin/sh` 只会在 `rc-service` 下报找不到
   `ebegin`/`eend`/`start_pre` 之类的函数。
2. `command=` 写**绝对路径**；`directory=` 是工作目录（对应 systemd 的 `WorkingDirectory=`）。
   ⚠️ 更关键的是：这行必须是**字面路径**，不能写 `${SPLAYER_ATOM_ROOT}/bin/…`。
   GP 菜单「05. 启用/禁用软件」的存在性探针（`script/enable/values.sh` 的 `gp_menus_probe`）
   会 `sed` 出 `command=` 这一行的**原文**，再对它做 `[ -f ]` —— 它**不解析变量**，写成变量拼接
   的服务会被判成 `NOT INSTALLED`，菜单开关直接消失（本项目的产物脚本踩过这个坑，
   现已改回字面路径并加入门禁断言）。非标准安装根由 `install-openrc.sh` 改写这行字面路径。
   Core 的启动器必须在安装根下运行，否则它推导不到 `runtime/bin/node` 与 `app/`。
3. `supervisor="supervise-daemon"` 是 OpenRC 自带的守护 + 重启器，GP 上 17 个服务在用它
   （含 `splayer-atom-core`、`splayer-headless`、`splayer-android-web`）。不用 supervisor 时
   也可以用 `command_bg=yes` + `start_stop_daemon_args="--background --make-pidfile …"`
   托管一个已经会自驻留的进程（GP 的 `rdsa` 就是这么做的）。
4. **重启一定要有界**。`respawn_max=0` 表示无限重启：一个跑不起来的二进制会变成静默崩溃环，
   而 `rc-service <x> status` **仍然显示 started**（托管的是外壳进程）。我们在 GP 上踩过两次：
   `rdsa` 的 AVX2 产物在无 AVX 的 Celeron J1900 上 `SIGILL`（退出码 132），日志里只有
   `[supervisor] rdsa exited code=132 after 0s, restarting in …`，服务状态却是 started。
   有界重启（如上 5s / 120s / 10 次）会让状态与日志立刻暴露问题。**实测**：把 `SPLAYER_ATOM_ROOT`
   指向一个 `exit 132` 的假启动器后，`supervise-daemon` 在第 **11** 次崩溃时放弃退出，
   `rc-service status` 从 `started` 变成 `stopped`（rc=3）；同一场景在不限次时只会一直显示
   started，日志默默增长。
5. `respawn_period >= respawn_delay × respawn_max` 是实测约束：不满足时 `supervise-daemon`
   会打印 `Please decrease the value of --respawn-period …` 并退化为无限重启
   （`respawn_max` 自身默认 10，`respawn_period` 默认 12s；数值取自 `man 8 supervise-daemon`，
   约束来自实测，仓库内 `_materials/integration/openrc-headless/etc-init.d-splayer-headless` 保留了该注释）。
6. `pidfile` 放 `/run`（tmpfs），不要放安装目录；`output_log`/`error_log` 放 `/var/log`，
   安装目录不应用来堆积生产日志（与 Core 的日志约定一致）。
7. **可覆盖的参数都放进 `/etc/conf.d/<服务名>`**，不要在脚本里写死环境变量。OpenRC 会
   **先** source `/etc/conf.d/<x>`、**再**执行 init.d 脚本体（本机用探针实测：
   脚本体内读到的变量已经是 conf.d 的值），所以脚本里每一项可调参数都必须写成
   `: "${VAR:=默认}"`；写成普通赋值 `VAR=默认` 会把 conf.d 的值覆盖掉，用户改了不生效。
   想给 Core 传环境变量（例如 `ATOM_SERVER_PORT`），在 conf.d 里用 `export`。
8. `start_pre()` / `stop_post()` 用来做前置校验与清理。实例：`rdsa` 的 `start_pre()` 依次做
   `ulimit -l unlimited` 和「生成或校验本机 RAAT 身份文件」——注意这类前置**失败不要阻断启动**，
   否则一个可选的校准步骤会让服务起不来。
9. 需要「跑一次就退出」的编排型服务时，GP 的惯用写法是自定义 `start()`：`ebegin` → 后台子 shell
   干活 → `rc-service "$RC_SVCNAME" stop` → `eend`（见 `/etc/init.d/trim`、`/etc/init.d/gp_starter`）。
10. `depend()` 表达顺序：`need net`（网络是硬依赖）、`after localmount`（等本地盘挂好）、
    `after *`（GP 的收尾型服务用它排到最后）。GP 上的关键词语义是
    `need`（硬依赖，对方失败则自己不启动）、`use`（软依赖）、`after`/`before`（仅顺序）、`want`。
11. 运行用户：Diretta Host 与 ALSA 实时输出需要 root，GP 的默认服务就是 root 跑；若要以非 root
    运行，需要显式给 `command_user=` 并放开音频设备与 `rtprio`/`memlock`（`/etc/security/limits.conf`
    的 `@audio`/`@realtime`），Diretta 目标机不要这么做。
12. **不要在 GP 上调用 `systemctl`**：脚本里若写了 `systemctl restart …`，在 GP 上只会得到
    `command not found`，而且 `rc-service <x> status` 依然显示 started，属于最难查的一类故障。

### 部署前的自检

```sh
# 语法检查（OpenRC 脚本就是 POSIX shell，可以用 sh -n）
sh -n /etc/init.d/splayer-atom-core

# 干跑：只打印将要执行的 start/stop 流程，不真的动服务
rc-service -Z splayer-atom-core start

# 存在性（不启动）：rc=0 表示脚本可被 OpenRC 解析
rc-service -e splayer-atom-core
```

## 部署：在 GP 上首次安装

产物、安装布局、`data/` 的语义与 systemd 部署完全相同（见
[Core 部署与升级](./core-deployment.md)），差别只在服务注册这一步。

1. 解包产物到安装根（归档顶层就是安装根，没有外层目录）：

```sh
sudo mkdir -p /opt/splayer-atom-core
sudo tar -xzf splayer-atom-core-<版本>-<提交>-bundled-linux-x64.tar.gz -C /opt/splayer-atom-core
```

2. 先验证启动器，再装服务：

```sh
cd /opt/splayer-atom-core
./bin/splayer-atom-core        # 应打印启动日志并监听 14558，Ctrl-C 退出
```

3. 安装 OpenRC 服务脚本。产物内自带这一对（**不要用 `service/install-systemd.sh`**，GP 上没有
   systemctl）：

```sh
sudo ./service/install-openrc.sh --user splayer-atom   # 普通 ALSA Core
# 或: sudo ./service/install-openrc.sh --diretta        # Diretta Host / root
```

安装器做的事：把 `service/splayer-atom-core.openrc` 装成 `/etc/init.d/splayer-atom-core`（0755）——
安装根就是默认的 `/opt/splayer-atom-core` 时**按原样安装**（可与产物内文件校验 md5），换到别的根
则把这行字面路径一并改写；再写 `/etc/conf.d/splayer-atom-core`（非默认根才写 `SPLAYER_ATOM_ROOT`，
`--user` 模式再写 `command_user`），并在重装时**保留你在 conf.d 里自己加的行**。
它不替你启动、也不设开机自启（与 `install-systemd.sh` 的口径一致）；在 systemd 主机上它会
直接拒绝并提示改用 `install-systemd.sh`。

装完它会**再跑一次 GentooPlayer 自己的探针**（`script/enable/values.sh <服务>`）并打印结果；
如果探针报 `NOT INSTALLED`，会额外打一行 `WARNING`——正是为了拦住「服务能跑、但菜单里没有
开关」这种静默集成缺陷（详见开发要点里 `command=` 必须写字面路径的约束）。

4. 开机自启 + 立即启动：

```sh
sudo rc-update add splayer-atom-core default
sudo rc-service splayer-atom-core start
rc-service splayer-atom-core status   # exit 0 = started；3 = stopped
```

> 同一台机器上如果还启用了上一代 `splayer-headless`，它与 Core 的默认端口相同（都是 **14558**）：
> 先停掉它，或在 `/etc/conf.d/splayer-atom-core` 里 `export ATOM_SERVER_PORT=<其它端口>`，否则 Core
> 起动即 `EADDRINUSE`（有界重启约 11 次后放弃，`status` 变 stopped）。

5. 核对运行面：

```sh
rc-update show -v | grep splayer-atom-core     # 自启登记
rc-status default                              # 该运行级全部服务状态
curl -s http://127.0.0.1:14558/api/info        # atomVersion / atomCommit / sourceDirty
tail -n 50 /var/log/splayer-atom-core.log
```

### 登记进 GP 的两套管理界面

GP 用户通常不敲 `rc-*`，而是从菜单和面板操作。让服务出现在这两处，需要各改一个文件：

| 界面                      | 位置                                                                                                        | 做什么                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 菜单「05. 启用/禁用软件」 | `/opt/.gentooplayer/web/conf/runners/menu_enable_player.json` + `/opt/.gentooplayer/web/scripts/enablep.sh` | 菜单项 `-splayer-atom-core`；`enablep.sh` 的服务表里加一行                       |
| 「0. 软件网页」卡片       | `/opt/.gentooplayer/web/scripts/websoftware.sh`                                                             | 卡片表加一行 `SPlayer Atom Core\|…\|:14558\|splayer-atom-core\|\|openrc`         |
| Web 面板 `:8889`          | `/srv/py/service_manager.py`                                                                                | `TARGET_SERVICES`（受管控服务清单）、`SERVICE_DISPLAY_NAMES`、`SERVICE_CATEGORY` |

菜单的判定链（三个脚本各管一件事，缺一不可）：

```text
menu_enable_player.json          菜单定义：-<服务> + values/script + default/script
  → script/enable/values.sh <x>  下拉候选：服务存在给 enable/disable，否则给 NOT INSTALLED
  → script/enable/default.sh <x> 当前值：rc-update show -v 里有没有这个服务的 default 行
  → enablep.sh -<x> enable|disable
        enable : rc-update add <x> default && rc-service <x> restart
        disable: rc-update del <x> default && rc-service <x> stop
                 （若存在 /opt/.gentooplayer/web/scripts/script/enable/stop_hooks.sh，再调它收尾）
```

由此有两条必须记住的语义：

- **`disable` 只摘掉 `default` 运行级的自启并停止服务**，不会删 `/etc/init.d/<x>`；
  「菜单里关掉了，但服务还在跑」通常是别处（手工 `rc-service start`、其它运行级）又拉起来了。
- **`enable` 用的是 `rc-service restart`**，对已停止的服务等价于 `start`。

仓库里已经带了这一层的资产与脚本，不必手改面板文件：

```sh
ls _materials/integration/gp-menu/     # gp-menus.json、apply-gp-menus.py、deploy-gp-menus.sh
```

`0. 软件网页` 的卡片在 GP 上会同时看「端口是否在听」与「OpenRC 是否 started」，卡片行尾的
`openrc` 标志表示**只认 OpenRC 状态**、不做端口兜底——这正是同一端口上多张卡片一起亮过的修法。

## 升级与回滚

流程与 [Core 部署与升级](./core-deployment.md) 的目录级升级一致，唯一区别是把 `systemctl`
换成 `rc-service`。原则不变：**保留完整的旧安装**，让回滚永远不依赖「旧 Core 去读新 Core 迁移过的
`data/`」。

```sh
# 1) 停服务并确认（3 = stopped）
sudo rc-service splayer-atom-core stop
rc-service splayer-atom-core status

# 2) 旧安装整体改名，保留升级前的 data/
sudo mv /opt/splayer-atom-core /opt/splayer-atom-core.rollback

# 3) 解包新产物到原路径
sudo mkdir -p /opt/splayer-atom-core
sudo tar -xzf <新产物>.tar.gz -C /opt/splayer-atom-core

# 4) 用升级前持久状态的副本回填（复制而非移动）
sudo rm -rf /opt/splayer-atom-core/data
sudo cp -a /opt/splayer-atom-core.rollback/data /opt/splayer-atom-core/data

# 5) 只在服务定义本身有变化时才重装 init.d；然后启动
sudo install -m 0755 ./splayer-atom-core.openrc /etc/init.d/splayer-atom-core
sudo rc-service splayer-atom-core start
```

与 systemd 部署的三处差异：

- **运行级登记不受升级影响**：`/etc/runlevels/default/<x>` 是指向 `/etc/init.d/<x>` 的软链，
  只要服务名不变，升级无需再 `rc-update add`（重装 init.d 也不会动软链）。
- **`rc-service stop` 会等 `supervise-daemon` 把进程收干净**，返回后 `status` 应为 3；
  若仍是 0，先看 `/var/log/<x>.err.log`，再用 `rc-service <x> zap` 复位状态缓存。
- **GP 的 ramdisk 模式（`/usr` 为 tmpfs）下 `/etc` 的改动不持久**。本基线机是常规根文件系统
  （`mount -l` 里没有 `on /usr type tmpfs`），所以 `rc-update`/`install` 的结果能跨重启保留；
  如果在 ramdisk 模式的机器上部署，必须确认改动落在持久层，否则重启即回退。

回滚就是把回滚目录换回来再启动：

```sh
sudo rc-service splayer-atom-core stop
sudo mv /opt/splayer-atom-core /opt/splayer-atom-core.failed
sudo mv /opt/splayer-atom-core.rollback /opt/splayer-atom-core
sudo rc-service splayer-atom-core start
rc-status default                                   # 自启登记应仍在
curl -s http://127.0.0.1:14558/api/info             # 版本/提交应回到升级前
```

## 服务管理速查

```sh
rc-service <x> start|stop|restart|status|zap   # 单个服务；status: 0=started, 3=stopped
rc-service -l                                  # 列出全部可用服务
rc-service -e <x>                              # 是否存在该 init.d（rc=0 存在）
rc-service -Z <x> start                        # 干跑，只打印将要执行的步骤
rc-update add|del <x> default                  # 开机自启登记 / 撤销
rc-update show -v                              # 服务 → 运行级 一览（脚本里判自启用它）
rc-status default                              # 某运行级状态
rc-status --servicelist --nocolor              # 全部服务状态（面板用的就是这条）
rc-status --crashed                            # 崩溃过的服务
openrc default                                 # 重新走一遍 default 运行级
```

状态缓存在 `/run/openrc/`（`daemons`、`failed`、`inactive`、`options`、`scheduled` 等），
不要手改；需要把服务从异常状态复位时用 `rc-service <x> zap`。

日志与运行面：

| 内容            | 位置                                                              |
| --------------- | ----------------------------------------------------------------- |
| 服务 stdout     | `/var/log/<x>.log`（`output_log`）                                |
| 服务 stderr     | `/var/log/<x>.err.log`（`error_log`）                             |
| GP 面板操作历史 | `/opt/.gentooplayer/web/logs/`                                    |
| OpenRC 自身     | 默认**不**写 `/var/log/rc.log`（`/etc/rc.conf` 未开 `rc_logger`） |
| Core 运行面     | `curl http://127.0.0.1:14558/api/info`、`/api/session`            |

## 排障清单

| 现象                                                      | 先看什么                                          | 常见根因                                                                                                                                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status` 是 started，功能不通                             | `/var/log/<x>.err.log`、子进程是否在              | 无限重启掩盖了子进程崩溃（`respawn_max=0` + SIGILL/缺库）                                                                                                                                                        |
| `status` 是 3，起不来                                     | `/var/log/<x>.err.log`、`depend()`                | 依赖未满足（`need net` 但网络没起来）、`command=` 路径不存在                                                                                                                                                     |
| 改了 init.d 没生效                                        | `rc-service <x> zap` 后重试                       | 状态缓存仍是旧状态                                                                                                                                                                                               |
| 开机不自启                                                | `rc-update show -v`、`/etc/runlevels/default/<x>` | 忘了 `rc-update add`，或一次性服务自己 `stop` 了                                                                                                                                                                 |
| 菜单里关掉了但还在跑                                      | `rc-status default`、`ps`                         | 服务被其它运行级或手工命令拉起；`disable` 只管 default 运行级                                                                                                                                                    |
| 菜单显示 NOT INSTALLED                                    | `/etc/init.d/<x>` 的 `command=`                   | GP 的探针按 `command=` 指向的文件是否存在判断（见 `script/enable/values.sh`） （探针**不解析变量**）；`command=` 必须是**字面绝对路径**，写成 `${VAR}/…` 或经解释器包装（python/bash/node 之类）都会被判成未安装 |
| 脚本里 `systemctl` 报 not found                           | —                                                 | GP 没有 systemd，服务管理必须走 `rc-*`（本页骨架已按此写）                                                                                                                                                       |
| conf.d 里改了参数不生效                                   | 脚本里该项是不是 `VAR=默认`                       | 普通赋值会覆盖 conf.d 的值；必须写成 `: "${VAR:=默认}"`（OpenRC 先 source conf.d）                                                                                                                               |
| 起动即 `EADDRINUSE: address already in use 0.0.0.0:14558` | `ss -ltnp \| grep 14558` 看谁占着                 | 上一代 `splayer-headless` 默认也监听 **14558**（实测某台 GP 上它开机自启并占用）；停掉它，或在 `/etc/conf.d/splayer-atom-core` 里 `export ATOM_SERVER_PORT=<其它端口>` 给 Core 换端口                            |
| 起动后 `status` 是 started，但日志反复重启                | `tail /var/log/splayer-atom-core.err.log`         | 端口冲突、缺库等启动期错误；有界重启约 11 次后放弃并把状态降为 stopped，不限次时只会一直显示 started                                                                                                             |

## 相关文件

- 产物内的 systemd 安装路径：[Core 部署与升级](./core-deployment.md)
- 产物内的 OpenRC 资产：`service/splayer-atom-core.openrc`（服务脚本）与
  `service/install-openrc.sh`（安装器）；源文件在 `scripts/atom/core-system/`
- 仓库内 OpenRC 资产：`_materials/integration/openrc-headless/`（`etc-init.d-splayer-headless`、
  `etc-init.d-splayer-android-web`、`部署说明.md`）
- 仓库内 GP 菜单资产：`_materials/integration/gp-menu/`
- 构建门禁与产物命名：[构建与打包](./build-and-packaging.md)
