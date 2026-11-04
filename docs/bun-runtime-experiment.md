# Bun Core 实验版本

> 最后更新：2026-11-04

本分支用于 Node Core 与 Bun Core 的对照验证，不替代原有 Node 发布流程。

## 构建

目标环境：Linux x86-64，Node `24.22.2`（构建），Bun `1.4.4`（Core 与插件 Host），Bubblewrap（插件沙箱），pnpm `11.5.2`，Rust、ALSA headers、Clang。

```bash
pnpm install --frozen-lockfile
pnpm build:native
pnpm typecheck
pnpm build:core
pnpm build:web
ATOM_BUN_BIN=/path/to/bun pnpm package:core:bun
```

打包命令复用现有编译产物，通过原有 Node staging 和 artifact smoke 验证，再生成独立的 `out/core-bun-system/` 和 `out/*-bun-*-system-linux-x64.tar.gz`。Bun 版目前为 **system-runtime**：需要安装系统 Bun、Bubblewrap 及允许的 user namespace/seccomp 内核功能。不修改现有 Node artifact 的启动入口。

## 运行

```bash
cd out/core-bun-system
ATOM_BUN_BIN=/path/to/bun ./bin/splayer-atom-core
```

普通 Node artifact 仍运行 `node`。Bun 启动器在 Bun 或 Bubblewrap 缺失时会立即退出，**不会**悄悄退回未隔离的 Bun 插件 Host。`/api/info` 的 `runtime` 字段显示真正的运行时，原 `node` 字段保留协议兼容信息。

## 对照测试

```bash
ATOM_BUN_BIN=/path/to/bun pnpm bench:core:bun
```

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

Bun `1.4.4` 接受 Node 的 `--permission` 参数，但未实际执行 Node 的文件和进程限制。Bun 插件 Host 因此在独立 Bubblewrap 文件/网络/进程 namespace 中执行，只挂载只读 Core 构建目录、运行时二进制及动态库，不暴露用户数据和主机网络；额外 seccomp 禁止创建新进程（但允许 Bun 需要的线程）。插件和 Core 使用 JSON IPC 加显式二进制编码。安全门禁已测试主机文件读取、主机 loopback 网络、进程创建、环境变量继承，以及经过主进程 Host API 的双向二进制消息。沙箱不可用时插件启动失败，不退回无约束运行。

`node:vm` 不是安全边界，插件即使借助宿主对象越过 VM，也应被外层 OS 沙箱阻断越权操作。这个实验隔离模型与 Node 权限模型不完全相同：受限环境仍允许 Bun 自身线程、沙箱内的临时文件以及已挂载系统库，尚未进行独立安全审计、资源配额和恶意插件模糊测试。对于其他发行版（尤其 GentooPlayer）、root Diretta 模式及完整插件负载仍需验收，不能因为本机通过就宣称生产等效。

首次测试建议选择独立设备和临时数据目录，避免与正在使用的 Core 同时占用 ALSA 或 Diretta 输出。当前实验包不作为生产发布物，也未完成 Debian 11、OpenRC、全部插件以及长时间硬件播放的验收。
