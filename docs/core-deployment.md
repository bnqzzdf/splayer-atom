# SPlayer Atom Core 部署与升级

> 最后更新：2026-10-20

本文描述当前 Core 技术产物在 Linux x86-64 上的 system-runtime 与 bundled-runtime 两种部署形态。

以下步骤以 **systemd** 为目标 init 系统。GentooPlayer 等 **OpenRC** 目标机没有 systemd，
产物内的 `service/install-systemd.sh` 在那里不可用；产物布局、`data/` 语义与回滚原则完全相同，
只有服务注册与启停命令不同，见 [GentooPlayer（OpenRC）服务管理](./gentooplayer-openrc.md)。

## 运行期约定

- Core 要求 Node `>=22.19.0`。
- 发布 / 参考版本校验使用 Node `24.18.0`。
- system-runtime 与 bundled-runtime 变体执行同一套 Core JS / 原生 / 协议约定。
- bundled-runtime 在 `runtime/bin/node` 内携带发布参考版本 Node `24.18.0`；system-runtime 要求宿主机提供 Node `>=22.19.0`。
- 当前生产产物仅支持 Linux x86-64。硬件支持范围仍取决于发布验收矩阵。
- Core HTTP/WS 只接受同源浏览器请求（拒绝跨站 `Origin`），`Host` 仅放行 IP、`localhost`、无点主机名与 `.local` / `.lan` / `.home.arpa` / `.internal` / `.localdomain`；
  经反向代理或自有域名访问时，用逗号分隔的 `ATOM_ALLOWED_HOSTS`（如 `music.example.com`）显式放行。
- 插件 host 子进程在 Node 权限模型（`--permission`）下运行，不能启动子进程、加载原生模块或写文件。

## glibc 与发行版兼容（Debian 11）

本产物在 **glibc 2.31 的 Debian 11（bullseye）容器**内构建，构建门禁也依赖这一点：
任一原生组件若需要高于 `GLIBC_2.31` 的符号，构建会直接中止，而不是发出一个不兼容的产物。

已发布原生组件的实测需求：

| 组件                                                   | 最高 glibc 符号需求 |
| ------------------------------------------------------ | ------------------- |
| `native/audio-engine.node`                             | `GLIBC_2.30`        |
| `native/streaming-api.node`                            | `GLIBC_2.30`        |
| `node_modules/better-sqlite3/prebuilds/linux-x64.node` | `GLIBC_2.29`        |

**因此该产物可在任意 glibc >= 2.30 的 x86-64 Linux 上运行——即 Debian 11 及更新版本。**

### Diretta SDK 与 glibc 下限

Diretta SDK 150 附带的预编译 `ACQUA` 库是在 glibc >= 2.38 上编译的：它们引用 C23 的整数解析函数
`__isoc23_strtol` / `__isoc23_strtoll`，而 libc 从 glibc 2.38 起才提供这两个符号。在 Debian 11 上
链接它们，此前会得到一个加载失败并报 `undefined symbol: __isoc23_strtol` 的 `audio-engine.node`。

`native/diretta-sys/src/glibc_compat.c` 提供了**弱符号**兜底：当 glibc < 2.38 时转调到标准
`strtol` / `strtoll`，从而让 Diretta 支持与 Debian 11 兼容得以共存。理由如下：

- SDK 中引用这两个符号的只有 `IPAddress.o` 与 `FileInf.o`——配置与 IP 地址解析，不涉及音频处理。
  它们解析点分十进制地址与普通十进制数值，不会用到 C23 的 `0b` 二进制前缀，因此在这些调用点上转调等价。
- 由于定义是弱符号、且在 glibc >= 2.38 时整个文件被条件编译排除，因此与新版 libc 不冲突。

如果 Diretta 日后发布基于更旧 glibc 构建的 ACQUA 库，应删除这层兼容垫片。

## 安装布局

归档内容就是安装根，**没有外层目录**；解包到目标路径即得到下面的布局：

```text
<安装根>/
├─ app/
├─ renderer/
├─ native/
├─ node_modules/
├─ bin/
├─ service/
├─ docs/
├─ data/
├─ runtime/                      # 仅 bundled-runtime：bin/node
├─ runtime.json
└─ LICENSE
```

`data/` 是持久状态，包含 SQLite 数据库、设置以及 provider/session 配置，升级过程中不得丢弃。
可重建的缓存不放在安装根内，遵循 Core 的 XDG 缓存路径。

## 首次安装

把发布产物解包到最终位置（例如 `/opt/splayer-atom-core`），然后在安装服务之前先验证启动器：

```bash
cd /opt/splayer-atom-core
./bin/splayer-atom-core
```

启动器优先使用显式给出的 `ATOM_NODE_BIN`；其次在存在 bundled 运行时时使用 `runtime/bin/node`；
否则使用系统 `node` 可执行文件。技术构建命令为：system-runtime 用 `build-core-system.ts`，
bundled-runtime 用 `build-core-system.ts --bundle-node`；两种归档都解包为同一套安装布局（无外层目录）。

### 普通 ALSA Core 的 systemd

按主机既有的账户管理策略创建一个专用服务账户，然后以 root 运行包内脚本：

```bash
sudo ./service/install-systemd.sh --user splayer-atom
sudo systemctl enable --now splayer-atom-core
```

该脚本安装的 unit 指向实际解包目录。它不会自动启动或启用服务。

目标机没有 systemd（GentooPlayer 等 OpenRC 系统）时改用包内的
`service/install-openrc.sh --user <账户>` / `--diretta`，再用
`rc-update add splayer-atom-core default` + `rc-service splayer-atom-core start`，
见 [GentooPlayer（OpenRC）服务管理](./gentooplayer-openrc.md)。

服务账户必须对安装目录下的 `data/` 与所配置的 XDG 缓存目录具备读写权限，并具备 ALSA 所需的音频设备权限。

### Diretta Core 的 systemd

Linux 上 Diretta Host 的连接与播放验证要求 Host 进程以 root 运行。对于要对外提供
Diretta Source Direct 的 Core 实例，需显式安装 root 模式的 unit：

```bash
sudo ./service/install-systemd.sh --diretta
sudo systemctl enable --now splayer-atom-core
```

不要以非 root 下的 Diretta 连接超时推断 Target 故障。当连接状态不明确时，Diretta 硬件验收还要求
Target 处于独占可用状态。

## 升级步骤

不要把新发布产物直接解包覆盖正在使用的安装。要保留完整的旧安装，使回滚永远不依赖于
「旧 Core 去读已被新 Core 迁移过的数据」。

假设当前安装为 `/opt/splayer-atom-core`。归档顶层就是安装根，因此直接解包进该路径即可。

1. 停止 Core 并确认服务已停止。

```bash
sudo systemctl stop splayer-atom-core
sudo systemctl is-active splayer-atom-core
```

2. 把当前完整安装改名到回滚目录。保持其完整，包括升级前的 `data/`。

```bash
sudo mv /opt/splayer-atom-core /opt/splayer-atom-core.rollback
```

3. 把新发布产物解包回原安装路径。

```bash
ARCHIVE=/path/to/the-built-system-linux-x64.tar.gz
sudo mkdir -p /opt/splayer-atom-core
sudo tar -xzf "$ARCHIVE" -C /opt/splayer-atom-core
# bundled-runtime 用对应的 bundled 归档，目标布局相同
```

选择由目标 Git 提交构建的产物。产物文件名已带 8 位提交号，可以先用它筛选；权威记录仍是包内的
`runtime.json.atomCommit`，部署前以它为准核对源码修订（口径同
[构建与打包](./build-and-packaging.md) 的「拿到一个 tar 就知道它出自哪次提交」）。

4. 用升级前持久状态的副本替换新产物中空的 `data/`。用复制而非移动，以便回滚目录仍可独立恢复。

```bash
sudo rm -rf /opt/splayer-atom-core/data
sudo cp -a /opt/splayer-atom-core.rollback/data /opt/splayer-atom-core/data
```

5. 按与旧安装相同的模式，从新产物重装 systemd unit，然后启动 Core。

```bash
sudo ./service/install-systemd.sh --user splayer-atom
# 或: sudo ./service/install-systemd.sh --diretta
sudo systemctl start splayer-atom-core
```

6. 在删除任何回滚副本之前，核对 `/api/info`、`/api/session`、Web Control 根页以及预期的媒体库状态。

当复制过来的持久状态使用较旧的已知 schema 时，Core 会在常规 store / 数据库初始化之前执行迁移。
只有当既有数据库或配置确实需要迁移时，才会在 `data/backups/migration-*` 下生成迁移备份。
SQLite 备份使用 `VACUUM INTO`，持久配置目录会被复制进同一快照。

Core 会拒绝比当前构建所能支持的更新的数据库或设置 schema。不要通过删除数据库或设置文件来绕过该拒绝。

## 回滚步骤

如果新 Core 未通过验收，不要让旧二进制去读新安装里可能已被迁移的 `data/`。

1. 停掉失败的 Core。
2. 保留失败的安装用于诊断，不要删除。
3. 把完整的升级前目录恢复回原路径。
4. 如果服务定义有变化，重装它的 systemd unit，然后启动。

例如：

```bash
sudo systemctl stop splayer-atom-core
sudo mv /opt/splayer-atom-core /opt/splayer-atom-core.failed
sudo mv /opt/splayer-atom-core.rollback /opt/splayer-atom-core
cd /opt/splayer-atom-core
sudo ./service/install-systemd.sh --user splayer-atom
# 或: sudo ./service/install-systemd.sh --diretta
sudo systemctl start splayer-atom-core
```

这种目录级回滚会同时恢复旧的可执行版本与其升级前的持久状态。较新的安装与任何迁移备份会保留下来
用于诊断，直到运维人员主动清理。

## 备份与恢复规则

- 在新版本通过验收之前，至少保留一份完整的升级前安装。
- 把 `data/` 当作权威持久状态；不要用缓存内容替换它。
- 迁移快照是对完整升级前目录的补充，不能替代「保留旧版本以便回滚」这一要求。
- 绝不要把「删掉数据库再重新扫描」当作 schema 迁移失败后的生产恢复流程。
- 除非该恢复场景已被显式验证过，不要只恢复 `library.db` 而保留较新的 provider / 设置文件。
  应优先恢复完整匹配的持久快照，或完整的旧安装。

## 服务诊断

安装、升级或回滚之后可用的检查：

```bash
systemctl status splayer-atom-core
journalctl -u splayer-atom-core -n 200 --no-pager
node --version
cat /opt/splayer-atom-core/runtime.json
```

在 OpenRC 目标机（GentooPlayer）上对应的检查是
`rc-service splayer-atom-core status`（退出码 0=started、3=stopped）、
`rc-status default` 与 `/var/log/splayer-atom-core.log`，见
[GentooPlayer（OpenRC）服务管理](./gentooplayer-openrc.md)。

`runtime.json` 同时也是发布溯源记录。诊断安装时请核对 `productName`、`atomVersion`、`atomCommit`、
`sourceDirty`、协议 / schema 版本以及运行期能力。正式干净发布应记录 `sourceDirty: false`；
从存在未提交改动的工作树本地构建的归档会显式记录 `true`，而不是假装仅凭 Git 提交就能标识确切的源码树。

Core 生产日志输出到 stdout/stderr，因此部署日志归 systemd/journald 所有。安装目录不应用来堆积生产日志文件。
