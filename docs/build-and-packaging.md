# SPlayer Atom 构建与打包

本文以当前仓库脚本和 `electron-builder.config.ts` 为准，说明 Desktop、Node Core、Rust/N-API 原生模块以及 Linux 发布产物的实际构建方式。架构边界见 [`build-flavors.md`](./build-flavors.md)，Core 安装/升级/回滚见 [`core-deployment.md`](./core-deployment.md)。

## 1. 构建面概览

SPlayer Atom 当前有两个主要发布面：

| 构建面    | 入口                                | 运行形态                             | 当前正式/技术产物                                      |
| --------- | ----------------------------------- | ------------------------------------ | ------------------------------------------------------ |
| Desktop   | `pnpm build:*`                      | Electron + Vue + Rust/N-API          | Windows NSIS/portable、macOS DMG/ZIP、Linux `tar.gz`   |
| Node Core | `scripts/atom/build-core-system.ts` | 普通 Node + Web Control + Rust/N-API | Linux x86-64 system-runtime / bundled-runtime `tar.gz` |

Desktop 与 Core 共用同一业务模型和播放权威。构建 flavor 只改变宿主和部署表面，不建立第二套 queue/provider/player。

## 2. 工具链要求

仓库根目录 `package.json` 当前约束：

- Desktop 开发：Node.js `>=22.19.0`；
- pnpm：`>=10`，仓库固定 `pnpm@11.5.2`；
- Rust：通过 rustup 安装稳定工具链；
- 正式 Core artifact 构建：**必须使用 Node `24.18.0`**；Core 运行时兼容范围为 `>=24.18.0 <25`。

Debian/Ubuntu 上常用的 Linux Desktop 原生构建依赖：

```bash
sudo apt update
sudo apt install -y build-essential clang pkg-config \
  libasound2-dev libdbus-1-dev libpipewire-0.3-dev libpulse-dev
```

Core `core-audio` flavor 只需要 ALSA 侧原生依赖，不要求 Desktop 的 PipeWire/PulseAudio 输出依赖。

## 3. 开发与通用构建

```bash
pnpm install
pnpm dev
```

`pnpm dev` 会先执行 debug 原生模块构建，再启动 Electron。只改 renderer 时可以临时跳过原生编译：

```bash
SKIP_NATIVE_BUILD=true pnpm dev
```

完整应用构建：

```bash
pnpm build
```

实际顺序是：

```text
清理 dist
→ scripts/build-native.ts 构建 release N-API 模块
→ pnpm typecheck
→ electron-vite build
```

只构建原生模块：

```bash
pnpm build:native         # release
pnpm build:native --dev   # debug
```

当前 Desktop native build 会按平台构建 `audio-engine`、`streaming-api`、`media-ctrl`、`opencc` 等模块；Windows 还包含 taskbar 模块，Linux/Windows 包含 `audio-capture`。

## 4. Desktop 打包

### 4.1 未打包目录

```bash
pnpm build:unpack
```

该命令先完整构建，再调用 `electron-builder --dir`。它适合：

- 安装器之前的本机运行验收；
- 检查最终 `resources/native/*.node`；
- Linux 上扫描 ELF/glibc 依赖；
- 排查 `asar`、`extraResources` 和 native addon 是否被正确带入。

### 4.2 Windows

```bash
pnpm build:win
# 显式架构示例
pnpm build:win --x64
```

当前 `electron-builder` 目标：

- NSIS installer：`SPlayer Atom-<version>-<arch>-setup.exe`；
- portable：`SPlayer Atom-<version>-<arch>-portable.exe`。

Windows 打包前还会运行 `scripts/gen-license.ts`。

### 4.3 macOS

```bash
pnpm build:mac
pnpm build:mac --arm64
pnpm build:mac --x64
```

当前目标为 `dmg` 和 `zip`。配置中 `identity: null`、`notarize: false`，因此本地构建不等同于已签名/公证的正式 macOS release。

### 4.4 Linux Desktop

```bash
pnpm build:linux
pnpm build:linux --x64
```

**当前只生成通用 `tar.gz`**。`electron-builder.config.ts` 的 Linux target 是：

```text
tar.gz
```

README 中旧的 AppImage/deb/rpm/pacman 描述已经不再适用于当前脚本。

### 4.5 架构规则

项目默认只支持当前构建主机架构，不把 `electron-builder --x64/--arm64` 当成完整的 native 交叉编译方案。Rust/N-API addon 必须与最终 Electron/Node 运行架构一致。

正式产物应在目标架构或经过完整验证的固定 builder 中生成。

## 5. Node Core 构建与打包

### 5.1 system-runtime

Host 自带兼容 Node，构建时仍必须使用 reference Node `24.18.0`：

```bash
pnpm exec tsx scripts/atom/build-core-system.ts
```

输出：

```text
out/splayer-atom-core-system-linux-x64.tar.gz
```

### 5.2 bundled-runtime

```bash
pnpm exec tsx scripts/atom/build-core-system.ts --bundle-node
```

输出：

```text
out/splayer-atom-core-bundled-linux-x64.tar.gz
```

bundled-runtime 会把 reference Node 放到 `runtime/bin/node`，但这**不会消除 glibc 依赖**：Node 本身、`better-sqlite3`、`audio-engine.node`、`streaming-api.node` 等仍然是 Linux ELF/native binary。

### 5.3 Core build pipeline

`build-core-system.ts` 当前自动执行：

```text
core-audio native release
→ Core JS
→ plugin-host IPC smoke
→ Web Control
→ Core dependency/Electron audit
→ runtime staging
→ tar.gz
→ 解包后的 native / HTTP / Web / schema / startup / termination smoke
```

Core native 只包含：

```text
audio-engine.node
streaming-api.node
```

其中 `audio-engine` 使用 `--no-default-features --features core-audio`，Linux 下保持 ALSA-only，不携带 Desktop 的 PipeWire/PulseAudio feature set。

## 6. Diretta 构建

SDK 不在仓库内。普通构建可以没有 Diretta：

```bash
pnpm exec tsx scripts/atom/build-core-system.ts
```

需要正式 Diretta Core artifact 时：

```bash
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK \
  pnpm exec tsx scripts/atom/build-core-system.ts --require-diretta
```

自带 Node runtime 的 Diretta 版本：

```bash
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK \
  pnpm exec tsx scripts/atom/build-core-system.ts --require-diretta --bundle-node
```

当前脚本会读取 SDK 的 `Host/Release.hpp` 并要求 Diretta Host SDK release `150`。`--require-diretta` 下 SDK 缺失或 release 不匹配会在生成同名正式 artifact 前失败。

Desktop 的 `scripts/build-native.ts` 则是在检测到 `DIRETTA_SDK_ROOT` 时为 `audio-engine` 增加 `diretta` feature；没有该变量时正常构建非 Diretta Desktop。

## 7. Linux glibc / ABI 兼容性

### 7.1 为什么本机 glibc 会影响产物

Linux Desktop/Core 都包含动态链接 ELF：Electron/Node、N-API `.node`、`better-sqlite3` 及 Rust/C/C++ 依赖。项目当前**没有**通过专用 sysroot、manylinux 风格工具链或 linker version script 固定一个最低 glibc。

因此在 glibc 2.43 的主机直接编译时，只要编译器/依赖实际引用了 2.43 才提供的符号，最终文件就会出现 `GLIBC_2.43` symbol requirement。目标机只有 glibc 2.39/2.35 时，该文件就无法加载。

这不是“编译机是 2.43，所以每个文件一定要求 2.43”，而是最终最低版本取决于**实际引用到的最高 GLIBC symbol version**。

### 7.2 发布规则

Linux 公共 artifact 不应直接在滚动发行版/开发者日常系统上构建。应先选择并固定发布 builder/sysroot：

- 希望覆盖到 glibc 2.35 的系统，就必须在不高于该 ABI 的受控环境中完成所有 native 构建并验证；
- 如果选择 Ubuntu 24.04 作为固定 builder，其系统 glibc 基线为 2.39；
- 最终兼容下限仍以**最终 artifact 扫描结果**为准，而不是只看 builder 的 `ldd --version`。

当前 `.github/workflows/dev.yml` 使用 `ubuntu-latest`，它是持续变化的 GitHub runner 标签，因此**不能作为长期固定的最低 glibc 承诺**。正式 Linux release 应改用明确版本的 runner/container，或单独的固定发布环境。

### 7.3 检查构建机

```bash
ldd --version
```

### 7.4 检查单个 ELF 的最高 glibc requirement

```bash
objdump -T path/to/file \
  | grep -o 'GLIBC_[0-9.]*' \
  | sort -Vu
```

最后一行就是该文件实际引用到的最高 GLIBC symbol version。

### 7.5 扫描最终目录

Desktop 推荐先：

```bash
pnpm build:unpack
```

然后扫描 `dist/`；Core 则扫描 staging/解包后的 artifact。通用示例：

```bash
find dist out -type f \( -name '*.node' -o -name '*.so' -o -perm -111 \) -print0 |
while IFS= read -r -d '' file; do
  max=$(
    objdump -T "$file" 2>/dev/null |
      grep -o 'GLIBC_[0-9.]*' |
      sort -Vu |
      tail -1
  )
  [ -n "$max" ] && printf '%-14s %s\n' "$max" "$file"
done
```

发布时要检查**最高值**，不能只扫描 `audio-engine.node`。Electron/Node、`better-sqlite3`、其他 `.node` 都可能成为真正的 ABI 下限来源。

## 8. 发布前验证

通用软件门禁：

```bash
pnpm typecheck
pnpm test
```

音频 Core 变更至少应执行：

```bash
cargo fmt --check -p audio-engine-core
cargo test -p audio-engine-core
```

Linux Desktop native 基线可额外执行：

```bash
cargo test -p audio-engine
```

Core 正式构建脚本自身已经包含最终 artifact smoke，不要只运行内部 Vite build 就把 `out/core` 当成 release artifact。

Linux 公共 release 还应额外确认：

1. 工作区 clean，release provenance 不记录 `sourceDirty: true`；
2. 使用固定 builder/sysroot，而不是任意本地环境；
3. 最终解包产物所有 ELF 的最高 `GLIBC_x.y` 符合目标兼容下限；
4. native addons 在最终 Electron/Node runtime 中可实际加载；
5. Desktop/Core 对应真实音频/输出硬件 gate 已完成。

## 9. 当前 CI 与正式发布的区别

当前仓库实际提交的 `.github/workflows/dev.yml` 主要负责 `dev` 分支 Desktop matrix：Windows、macOS、Linux；使用 Node 22.x、Rust stable，并在 Linux 上执行 `pnpm build:linux --x64`。

Core 的 `build-core-system.ts`、Diretta SDK release 检查、artifact smoke 已经在仓库脚本层存在，但当前 checked-in workflow **不能等价视为完整的 Core/Diretta 正式发布流水线**。正式发布仍需要固定 Linux ABI builder、SDK 受控环境以及 roadmap/hardware checklist 中的最终验收。
