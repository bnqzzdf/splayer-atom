# Bun Core 实验版本

本分支用于 Node Core 与 Bun Core 的对照验证，不替代原有 Node 发布流程。

## 构建

目标环境：Linux x86-64，Node `24.22.2`（构建及插件 Host），Bun `1.4.4`（实验验证版本），pnpm `11.5.2`，Rust、ALSA headers、Clang。

```bash
pnpm install --frozen-lockfile
pnpm build:native
pnpm typecheck
pnpm build:core
pnpm build:web
ATOM_BUN_BIN=/path/to/bun pnpm package:core:bun
```

打包命令复用现有编译产物，通过原有 Node staging 和 artifact smoke 验证，再生成独立的 `out/core-bun-system/` 和 `out/*-bun-*-system-linux-x64.tar.gz`。Bun 版目前为 **system-runtime**：需要安装系统 Bun，且保留系统 Node 作为受限插件 Host 的执行器。不修改现有 Node artifact 的启动入口。

## 运行

```bash
cd out/core-bun-system
ATOM_BUN_BIN=/path/to/bun ATOM_PLUGIN_HOST_NODE_BIN=/path/to/node ./bin/splayer-atom-core
```

普通 Node artifact 仍运行 `node`。Bun 启动器在 Bun 或 Node 缺失时会立即退出，**不会**将插件 Host 悄悄改成 Bun。`/api/info` 的 `runtime` 字段显示真正的运行时，原 `node` 字段保留协议兼容信息。

## 对照测试

```bash
ATOM_BUN_BIN=/path/to/bun ATOM_PLUGIN_HOST_NODE_BIN=/path/to/node pnpm bench:core:bun
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

Bun `1.4.4` 接受 Node 的 `--permission` 参数，但未实际执行 Node 的文件和进程限制。因而 `pluginHost.ts` 在 Bun 主进程下固定以系统 Node 启动插件 Host，通过 JSON IPC 加显式二进制编码交换消息，保留 Node 原有的权限模型。不能把这个实验版本描述为完全不依赖 Node 的 Bun 播放器。

首次测试建议选择独立设备和临时数据目录，避免与正在使用的 Core 同时占用 ALSA 或 Diretta 输出。当前实验包不作为生产发布物，也未完成 Debian 11、OpenRC、全部插件以及长时间硬件播放的验收。
