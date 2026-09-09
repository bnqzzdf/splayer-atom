# SPlayer Atom

SPlayer Atom 是一个面向 Linux x86-64 的音乐播放 Core，配套唯一的 Web Control 界面。

项目不提供 Desktop/Electron 版本，也不提供 Windows/macOS 安装包。Node Core 是数据库、设置、曲库、队列、播放策略、音源解析、缓存、下载、统计、插件、在线服务与输出设备的唯一权威；浏览器只通过 Core HTTP/WS 协议发送高层命令并消费状态投影。

## 产品形态

```text
Browser
  │ HTTP / WebSocket
  ▼
SPlayer Atom Web Control
  │
  ▼
SPlayer Atom Node Core
  ├─ Library / DB / Settings / Queue
  ├─ Netease / Qobuz / TIDAL / Streaming
  ├─ Cache / Download / Plugins / ListenBrainz
  └─ Playback authority
       ├─ ALSA
       ├─ Diretta Source Direct
       └─ UPnP Renderer
```

当前正式发布目标只有 **Linux x86-64**。

## 主要能力

- 本地曲库扫描、搜索、专辑/歌手聚合与标签编辑
- CUE 虚拟分轨与 SACD stereo 虚拟分轨
- Netease、Qobuz、TIDAL 在线服务
- Jellyfin / Subsonic 类自建媒体服务
- 插件系统与 LX `user_api` 兼容层
- ListenBrainz Now Playing / Scrobble
- ALSA 普通播放
- Diretta strict Source Direct
  - PCM 保持源采样率、声道数、有效位深与样本值
  - Native DSD 保持逻辑 one-bit 序列
  - 不允许静默 resample、remix、DSP 或 PCM fallback
- UPnP 单 Renderer 输出，共用同一 Core queue/source/cache 权威
- Web Control 多客户端连接、HTTP/WS 状态投影

## 环境要求

- Linux x86-64
- Node.js `>=24.18.0 <25`
- pnpm `>=10`
- Rust stable
- ALSA 开发依赖、Clang、pkg-config

Ubuntu/Debian 类系统可安装：

```bash
sudo apt-get update
sudo apt-get install --no-install-recommends -y \
  libasound2-dev pkg-config clang libarchive-tools
```

## 开发

```bash
pnpm install
pnpm dev
```

`pnpm dev` 会先构建 debug native addons，再启动 Node Core 与 Web Vite 开发服务。

常用检查：

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
cargo check --workspace
cargo test --workspace
pnpm docs:build
```

## 构建

```bash
pnpm build
```

完整构建顺序：

1. 构建 `audio-engine.node` 与 `streaming-api.node`
2. Node/Web typecheck
3. 构建 Node Core bundle
4. 构建 Web Control

单独构建：

```bash
pnpm build:native
pnpm build:core
pnpm build:web
```

## 打包

system-runtime：

```bash
pnpm package:core
```

bundled-runtime（包内携带 reference Node）：

```bash
pnpm package:core:bundled
```

产物位于 `dist/`：

```text
splayer-atom-core-system-linux-x64.tar.gz
splayer-atom-core-bundled-linux-x64.tar.gz
```

Diretta 正式构建必须显式提供支持的 Host SDK：

```bash
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK \
  pnpm exec tsx scripts/atom/build-core-system.ts --require-diretta
```

SDK 不进入仓库，也不会被打进 release artifact。

## Linux glibc 兼容性

Core artifact 包含 Rust/N-API ELF。最终最低 glibc 版本取决于构建环境与实际引用的版本化符号，而不是 package.json 中的配置。

正式发布应在固定的较老 Linux builder/sysroot 中构建，并扫描最终 tar 内所有 ELF 的最高 `GLIBC_x.y`。不要直接使用滚动发行版或 glibc 2.43 开发机作为公开发布 builder。

详见 [构建与打包](./docs/build-and-packaging.md)。

## 部署

Core 支持 system-runtime 与 bundled-runtime 两种部署方式，共享同一个 Core/Web 协议和数据目录模型。systemd、数据目录、升级与回滚流程见 [Core 部署](./docs/core-deployment.md)。

## 文档

- [Atom Roadmap](./docs/atom-roadmap.md)
- [开发环境](./docs/atom-development.md)
- [构建与打包](./docs/build-and-packaging.md)
- [Build Flavors](./docs/build-flavors.md)
- [Core 部署](./docs/core-deployment.md)
- [原生模块](./docs/native.md)
- [硬件发布验收](./docs/hardware-release-checklist.md)
- [在线服务验收](./docs/live-provider-acceptance.md)
- [UPnP 输出方案](./docs/upnp-output-plan.md)

## License

GNU Affero General Public License v3.0，见 [LICENSE](./LICENSE)。
