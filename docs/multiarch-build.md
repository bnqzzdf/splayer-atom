# 多架构 / 多 CPU 变体构建与安装

> 最后更新：2026-11-11

本文描述 x86-64（v1/v2/v3/v4/zen4）与 aarch64（arm64）的 Core 构建、两个发布包和统一安装器。
安装目录默认 `/opt/splayer-atom-core`；`--prefix` 可覆盖（例如 audiosys 环境的 `/audiosys`）。

## 构建矩阵

| 包 | 变体 | Diretta | 说明 |
| --- | --- | --- | --- |
| `linux-x86_64-multi` | `v1` | 否 | SDK 148 没有 x86 v1 库，只能 ALSA-only |
| `linux-x86_64-multi` | `v2` | SDK 148 | SSE4.2 / POPCNT |
| `linux-x86_64-multi` | `v3` | SDK 148 | AVX2 / BMI2 |
| `linux-x86_64-multi` | `v4` | SDK 148 | AVX-512 |
| `linux-x86_64-multi` | `zen4` | SDK 148 | AMD Zen 4 |
| `linux-aarch64-multi` | `arm64` | SDK 148 | aarch64 原生构建 |

x86 包不包含 arm64；arm 包不包含 x86。安装器会在写系统路径前核对包架构与变体表。

## 构建

### x86 五变体

在 Debian 11 builder 容器内，以同一份 Core/Web/Node 依赖为 base，只分别编译 native addons：

```bash
# v1: ALSA-only
env -u DIRETTA_SDK_ROOT -u DIRETTA_CPU_VARIANT \
  pnpm exec tsx scripts/atom/build-core-native.ts --output-dir out/native/v1

# v2/v3/v4/zen4
for v in v2 v3 v4 zen4; do
  DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK_148 DIRETTA_CPU_VARIANT=$v \
    pnpm exec tsx scripts/atom/build-core-native.ts \
      --require-diretta --diretta-variant=$v --output-dir out/native/$v
done
```

`out/native/<variant>/build.json` 记录该变体的 `arch/diretta/direttaCpuVariant`。

### arm64 原生

在 aarch64 构建机（本站 `.230`）上：

```bash
DIRETTA_SDK_ROOT=/root/DirettaHostSDK_148 \
  sh scripts/atom/build-arm64-native.sh
```

输出 `out/native/arm64/{audio-engine.node,streaming-api.node,build.json}`。
该脚本用 `cargo build --release` 直接产出 cdylib，再命名为 NAPI `.node`；不依赖 pnpm/napi CLI。

### 打包

以一份已构建的完整 x86 产物作为共享 base（app/renderer/node_modules/runtime），
把各变体 native + runtime.json 放入 `variants/`：

```bash
# x86 包
sh scripts/atom/package-multiarch.sh \
  --arch x86_64 \
  --base out/splayer-atom-core-...-linux-x64.tar.gz \
  --native-root out/native \
  --out out

# arm64 包
sh scripts/atom/package-multiarch.sh \
  --arch aarch64 \
  --base out/splayer-atom-core-...-linux-x64.tar.gz \
  --native-root /path/to/arm-native-root \
  --arm-node /path/to/node-v24.22.2-linux-arm64/bin/node \
  --arm-sqlite /path/to/prebuilds/linux-arm64.node \
  --out out
```

包名：

```text
splayer-atom-core-<version>-<commit8>-<YYYYMMDD>-linux-x86_64-multi.tar.gz
splayer-atom-core-<version>-<commit8>-<YYYYMMDD>-linux-aarch64-multi.tar.gz
```

包内结构：

```text
<top>/
  app/ renderer/ node_modules/ runtime/ data/ docs/ service/ bin/
  variants/
    v1/native/{audio-engine.node,streaming-api.node,build.json}
    v1/runtime.json
    ...
    manifest.txt
  PACKAGE_ARCH
  install.sh
  SHA256SUMS
```

## 安装

```bash
./install.sh --cpu auto
./install.sh --cpu v4
./install.sh --cpu v1                  # ALSA-only
./install.sh --prefix /audiosys/splayer-atom-core --cpu auto
./install.sh --init openrc --user splayer-atom
./install.sh --uninstall               # 保留 data/
./install.sh --uninstall --purge
./install.sh --rollback
```

- 默认安装到 `/opt/splayer-atom-core`。
- 自动选择：zen4 → v4 → v3 → v2 → v1；aarch64 → arm64。
- 安装器把选中的 `variants/<variant>/native` 放到 `native/`，把对应 `runtime.json` 放到根目录。
- 升级会保留 `data/`，程序文件备份到 `.backup-<时间戳>`；OpenRC 与 systemd 都支持。
- v1 没有 Diretta；需要 Diretta 时选 v2/v3/v4/zen4。
- 目标目录非空且不像 Atom 安装根时，安装器会拒绝覆盖；优先用专用子目录
  `/audiosys/splayer-atom-core`。只有确认 `/audiosys` 是专用根且可覆盖时，才使用
  `--prefix /audiosys --force`。

## 闸门

```bash
sh scripts/atom/check-multiarch-package.sh out/...-linux-x86_64-multi.tar.gz
sh scripts/atom/check-multiarch-package.sh out/...-linux-aarch64-multi.tar.gz
```

检查：包名/架构、变体表、ELF 架构、bundled Node、better-sqlite3 prebuild、每个
`runtime.json` 的 `arch/diretta/direttaCpuVariant`、包内 SHA256SUMS、install.sh 语法与权限、
禁止符号链接。x86 包额外检查 v1 的 `diretta=false`；arm 包只允许 arm64。

## 验收记录（2026-11-11）

构建环境：

- x86 五变体：`.133` Debian 11 builder 容器，Node 24.22.2，Diretta SDK 148。
- arm64：`.230` aarch64 原生构建，Rust 1.99.0，Diretta SDK 148 aarch64 库。

产物：

| 包 | 大小 | SHA256 |
| --- | --- | --- |
| `splayer-atom-core-1.2.0-e587aa55-20261111-linux-x86_64-multi.tar.gz` | 90 MB | `f49e9be5ae88da82d1bfc660c0f9f0f47593de9bc019381883e2a54f3201e3e6` |
| `splayer-atom-core-1.2.0-e587aa55-20261111-linux-aarch64-multi.tar.gz` | 55 MB | `33e6b648b88391925341948fc723a0a9c05146ee3c4a22119d8e1ecd88d324d5` |

包闸门：

- x86：`v1 v2 v3 v4 zen4` 全部 ELF x86-64，v1 `diretta=false`，其余 `diretta=true/sdk=148`；
  bundled Node 与 better-sqlite3 为 x64；PASS。
- arm：`arm64` ELF aarch64，`diretta=true/sdk=148/variant=arm64`；bundled Node 与
  better-sqlite3 为 arm64；PASS。

安装/启动验证：

- `.137` x86 包 `--cpu v4`：安装到测试前缀，Core `/api/info` 返回 `arch=x64`、
  `node=24.22.2`、`direttaSdkRelease=148`、`capabilities.diretta=true`；native 加载成功。
- `.137` x86 包 `--cpu v1`：`direttaSdkRelease=null`、`capabilities.diretta=false`；native 加载成功。
- `.230` arm 包 `--cpu arm64`：`arch=arm64`、`node=24.22.2`、`direttaSdkRelease=148`、
  `capabilities.diretta=true`；native 加载成功。
- arm64 编译中发现并修复 `direct_pcm.rs` 的 `c_char` 有符号性（`a5a25b14`），x86 不受影响。

## 审计结论（本轮）

- 静态/动态闸门：`pnpm typecheck`、`pnpm lint`、`pnpm test`、最终 `cargo test --workspace`
  与 clippy 1.98.0 均通过。
- 已修复：arm64 `c_char` 有符号性；`--output-dir` 参数顺序；base 产物 SHA256 校验；
  native `build.json` 与包架构/变体一致性校验；arm64 构建 `--locked`；
  安装器对“非空且不像 Atom 安装根”的目录拒绝覆盖（需 `--force`）。
- 归一化：`DirettaCpuVariant` 明确区分 x86 变体与 arm64；文档/脚本/包清单使用同一套
  `v1/v2/v3/v4/zen4/arm64` 名称。
- 冗余/性能：DST-DFF 提取实测 96 ms（对照 DSF 28.3 s），已消除 DST 解码；剩余开销是
  I/O 与 chunk 写出，继续改 native 分配器收益很低，且会让已验证产物失效，本轮不做。

说明：安装目录默认 `/opt/splayer-atom-core`；测试使用独立前缀以免覆盖已有生产 Core。
audiosys 环境建议用 `--prefix /audiosys/splayer-atom-core`；直接覆盖 `/audiosys` 需显式 `--force`，
安装器默认会拒绝非空且不像 Atom 安装根的目录。
