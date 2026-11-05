# Core Runtime Flavor：Node / Bun

> 最后更新：2026-11-05

> 历史方案或测试记录：当前状态及未完成验收请以[路线图](../atom-roadmap.md)为准。

Node 与 Bun 已使用同一套 Core 源码、编译产物、打包入口和验收流程。默认正式运行时仍为 Node；Bun 是可选 Flavor，尚需各目标系统的长期播放回归。

## 构建

目标环境：Linux x86-64，Node `24.22.2`（仅构建与验收），Bun `1.4.4`（Core 与插件 Host），pnpm `11.5.2`，Rust、ALSA headers、Clang。

```bash
pnpm install --frozen-lockfile
pnpm build:native
pnpm typecheck
pnpm build:core
pnpm build:web
pnpm package:core                     # Node system
pnpm package:core:bundled             # Node bundled
ATOM_BUN_BIN=/path/to/bun pnpm package:core:bun
ATOM_BUN_BIN=/path/to/bun pnpm package:core:bun:bundled
```

四个命令均使用 `scripts/atom/build-core-system.ts`，可以直接使用 `--runtime=node|bun` 与 `--bundle-runtime` 组合。现有 `--bundle-node` 仍等价于 Node bundled。打包时通过共同的 Core staging 与 artifact smoke 验证，再生成独立的产物：

- **system-runtime**：需要系统提供所选 Node/Bun。
- **bundled-runtime**：自带 `runtime/bin/node` 或 `runtime/bin/bun`，目标机不需要单独安装运行时。

安装包共用 `bin/splayer-atom-core` 启动器、Web 与原生模块；Bun Flavor 通过 `runtime/bun` 标记选择自身运行时。Bun 归档名有 `-bun-` 后缀，Node 的历史归档命名不变。Bun bundled 另有发行许可证提示；公开分发前需审核 Bun 及其静态链接组件的许可证义务。

## 运行

```bash
cd out/core-system
ATOM_BUN_BIN=/path/to/bun ./bin/splayer-atom-core
```

普通 Node artifact 仍运行 `node`。Bun Flavor 在 Bun 缺失时会退出，插件 Host 通过 Bun 的 `child_process.fork` 运行在另一个 Bun 进程中。`/api/info` 的 `runtime` 字段显示真正的运行时，原 `node` 字段保留协议兼容信息；「关于」页面优先显示真正的运行时。

### 独立测试 bundled 包的播放

下面是 Linux x86-64 的测试示例。建议使用临时目录及另一个 HTTP 端口，不要覆盖正在运行的 Node Core：

```bash
mkdir -p "$HOME/atom-bun-trial"
tar -xzf splayer-atom-core-*-bun-bundled-linux-x64.tar.gz -C "$HOME/atom-bun-trial"
export ATOM_DATA_DIR="$HOME/atom-bun-trial/data"
export ATOM_CACHE_DIR="$HOME/atom-bun-trial/cache"
export ATOM_SERVER_PORT=27234
"$HOME/atom-bun-trial/bin/splayer-atom-core"
```

浏览器访问 `http://<设备IP>:27234`，通过 Web Control 选择已有音乐目录、音频输出，测试本地 PCM/DSD、切歌、暂停、seek；Diretta 测试需要实际 Target、匹配的原生 SDK 和权限。默认构建的 CPU 变体以 `runtime.json` 中 `direttaCpuVariant` 为准（2026-11-04 测试包为 v2）。Linux 目标机仍须满足 Bun/glibc、N-API 原生模块与音频硬件的兼容性条件。

## 对照测试

```bash
ATOM_BUN_BIN=/path/to/bun pnpm bench:core:bun
```

基准脚本从 `out/` 中按 Runtime Flavor 找最新的 Node/Bun **system-runtime 归档**并分别解压，不依赖任何独立 Bun staging 目录；运行前需先为两个 Runtime 都生成归档。

脚本交替启动 Node 和 Bun 各 5 次，用单独的临时 HOME、空白数据库、缓存和音乐目录测量 API 就绪耗时、静置主进程 RSS/PSS、100 次连续 `/api/info` HTTP 请求吞吐量。结果保存至 `out/bun-node-benchmark.json`。这不是播放性能、音质或长时间稳定性的基准。实际播放及 Diretta 硬件回归需要另外进行。

2026-11-04 在同一机器、同一 Git 基线和同一原生 addon 下得到以下中位数：

| 指标 | Node 24.22.2 | Bun 1.4.4 |
| --- | ---: | ---: |
| 启动至 `/api/info` 就绪 | 230.4 ms | 194.4 ms |
| 主进程 RSS | 94.9 MiB | 76.7 MiB |
| 主进程 PSS | 54.6 MiB | 71.9 MiB |
| 串行 HTTP `/api/info` | 773.9 次/秒 | 950.2 次/秒 |

这里的 RSS 虽然 Bun 更低，但 PSS 反而 Node 更低。机器上已有其他 Node 进程，因此不同运行时共享库的分摊会改变 PSS；不能仅看 RSS 就断言总内存开销下降。HTTP 测量轮间波动较大，结果仅用于初筛。

本次尝试重新编译 Rust Release addon 时，LLVM 内部在 LTO 阶段发生 SIGSEGV；并行构建时 Vite 也曾发生 SIGSEGV。串行重试 Vite 成功，Rust 部分改用原 checkout 同一提交 `08138040` 的已编译原生模块。Node/Bun 测试使用的是同一份原生二进制，而不是两套不同构建。此环境异常尚未排查为具体根因。

## 安全与局限

Bun `1.4.4` 接受 Node 的 `--permission` 参数，但未实际执行 Node 的文件和进程限制。Bun 插件 Host 仅使用独立进程和各插件的 `node:vm` Context 隔离执行与生命周期；插件和 Core 通过 JSON IPC 加显式二进制编码交互。**这些措施不构成恶意代码安全沙箱：`node:vm` 可以被绕过，插件代码可能获得进程、文件、网络、子进程等系统权限。** Bun 实验版本只允许安装用户明确信任来源的插件，不承诺安全执行不可信第三方插件。不要把插件目录暴露给未授权用户，也不要自动安装未经审核的插件。

原 Node 版本仍保留既有 `--permission` 配置；但 Node 官方同样不将其视为针对恶意代码的安全沙箱。若未来要公开分发不可信插件，应另立需求重新设计进程级权限控制，而非将当前 VM 机制描述为安全隔离。其他发行版（尤其 GentooPlayer）、root Diretta 模式及完整插件负载仍需验收。

首次测试建议选择独立设备和临时数据目录，避免与正在使用的 Core 同时占用 ALSA 或 Diretta 输出。当前实验包不作为生产发布物，也未完成 Debian 11、OpenRC、全部插件以及长时间硬件播放的验收。
