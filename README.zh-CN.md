# SPlayer Atom

SPlayer Atom 是在 [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next) 基础上修改的 Linux x86-64 音乐播放器，采用 **Web + Core** 模式：后台 Node Core 负责曲库、在线服务、播放队列和音频输出，日常操作通过浏览器中的 Web Control 完成。

这种模式适合把播放器长期运行在 Linux 主机、音乐服务器或 HiFi 主机上，再从电脑、平板或手机浏览器进行控制。关闭某个浏览器页面不会停止 Core 中正在进行的播放。

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
  └─ Playback / Output
       ├─ ALSA
       ├─ Diretta Source Direct
       └─ UPnP Renderer
```

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
- UPnP 单 Renderer 输出，与本地输出共用同一套 Core 播放队列和音源处理流程
- 多个 Web Control 可以同时连接同一个 Core，并实时同步播放状态

## 环境要求

- Linux x86-64
- Node.js `>=22.19.0`
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

产物位于 `out/`，文件名包含版本号和构建日期：

```text
splayer-atom-core-<version>-<YYYYMMDD>-system-linux-x64.tar.gz
splayer-atom-core-<version>-<YYYYMMDD>-bundled-linux-x64.tar.gz
```

Diretta 正式构建必须显式提供支持的 Host SDK：

```bash
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK \
  pnpm exec tsx scripts/atom/build-core-system.ts --require-diretta
```

## 部署

Core 支持 system-runtime 与 bundled-runtime 两种部署方式，两者运行相同的 Core/Web 功能并使用相同的数据目录结构。systemd、数据目录、升级与回滚流程见 [Core 部署](./docs/core-deployment.md)。

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
