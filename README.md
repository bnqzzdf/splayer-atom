# SPlayer Atom

> 最后更新：2026-10-26

**简体中文** · [English](./README.en.md)

SPlayer Atom 是运行在 Linux 主机上的音乐播放器，基于 [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next) 修改。

它作为后台服务常驻运行，局域网内的电脑、平板、手机用浏览器打开即可控制。关掉网页不影响播放，多台设备看到的是同一份播放状态。适合装在音乐服务器或 HiFi 主机上长期使用。

## 功能

- **本地曲库**：目录扫描与增量更新、专辑 / 歌手 / 文件夹浏览、标签编辑、CUE 与 SACD 立体声分轨
- **在线音乐**：网易云音乐、QQ 音乐、酷狗音乐、Qobuz、TIDAL
- **自建媒体服务器**：Subsonic、Navidrome、OpenSubsonic、Airsonic、Gonic、LMS、Jellyfin、Emby
- **歌词**：LRC、QRC、YRC、KRC、TTML、LyS、SRT、ASS，支持逐字和双语显示
- **音频输出**
  - ALSA：可使用均衡器、响度、变速
  - Diretta：采样率、位深、声道原样输出，DSD 原生传输，不做任何处理；目标设备不支持的格式会直接报错
  - UPnP 渲染器
- **其他**：无缝播放、插件（兼容 LX Music `user_api` 脚本）、ListenBrainz 听歌记录、下载、播放统计

Atom 不提供删除音乐文件的功能，清理操作只涉及它自己的缓存和临时文件。

## 安装

目前没有预编译包，需要先按下文[从源码构建](#从源码构建)打出安装包（`out/splayer-atom-core-*-linux-x64.tar.gz`）。

安装包解压后就是安装目录。以 systemd 系统为例：

```bash
sudo mkdir -p /opt/splayer-atom-core
sudo tar -xzf splayer-atom-core-*-linux-x64.tar.gz -C /opt/splayer-atom-core
cd /opt/splayer-atom-core

# splayer-atom 为事先创建的服务账户；使用 Diretta 时改为 --diretta（以 root 运行）
sudo ./service/install-systemd.sh --user splayer-atom
sudo systemctl enable --now splayer-atom-core
```

然后用浏览器打开 `http://<主机 IP>:14558`。

- OpenRC 系统（如 GentooPlayer）改用 `service/install-openrc.sh`，见 [GentooPlayer（OpenRC）服务管理](./docs/gentooplayer-openrc.md)。
- 通过域名或反向代理访问时，需要用 `ATOM_ALLOWED_HOSTS` 放行对应域名。
- 曲库、设置和登录凭据都在安装目录下的 `data/` 里，升级时要保留。升级与回滚步骤见 [Core 部署与升级](./docs/core-deployment.md)。

## 从源码构建

需要：

- Linux x86-64
- Node.js 24.18.0（打包脚本会校验版本；日常开发 `>=22.19.0` 即可）
- pnpm `>=10`
- Rust stable
- ALSA 开发头文件、Clang、pkg-config

Debian / Ubuntu 安装系统依赖：

```bash
sudo apt-get install --no-install-recommends -y libasound2-dev pkg-config clang
```

打包：

```bash
pnpm install
pnpm package:core            # 使用主机上的 Node.js
pnpm package:core:bundled    # 安装包自带 Node.js
```

带 Diretta 的版本需要提供 Diretta Host SDK，并按目标 CPU 选择变体（`v2` / `v3` / `v4` / `zen4`，见 [CPU 变体](./docs/cpu-variants.md)）：

```bash
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK \
  pnpm exec tsx scripts/atom/build-core-system.ts --require-diretta --diretta-variant=v2
```

更多选项见 [构建与打包](./docs/build-and-packaging.md)。

## 开发

```bash
pnpm install
pnpm dev    # 构建 debug 版原生模块，并启动 Core 与 Web 开发服务
```

提交前检查：

```bash
pnpm typecheck && pnpm lint && pnpm test
cargo clippy --workspace --all-targets
cargo test --workspace
```

目录结构：

| 目录                       | 内容                                                             |
| -------------------------- | ---------------------------------------------------------------- |
| `core/`                    | Node Core：曲库、队列、播放控制、在线服务、HTTP / WebSocket 接口 |
| `src/`                     | Web 控制界面（Vue 3）                                            |
| `native/`                  | Rust 原生模块：音频引擎、Qobuz / TIDAL、Diretta SDK 绑定         |
| `shared/types/`            | Core 与 Web 共用的类型定义                                       |
| `scripts/atom/`、`docker/` | 构建与打包脚本                                                   |

## 文档

- [交付手册：项目书 / 开发 / 运维 / 使用 / 接口](./docs/handbook/README.md)
- [使用指南](./docs/guide.md)
- [Core 部署与升级](./docs/core-deployment.md) · [GentooPlayer（OpenRC）服务管理](./docs/gentooplayer-openrc.md)
- [构建与打包](./docs/build-and-packaging.md) · [构建面](./docs/build-flavors.md) · [CPU 变体](./docs/cpu-variants.md)
- [开发环境](./docs/atom-development.md) · [路线图](./docs/atom-roadmap.md) · [已完成事项](./docs/atom-completed.md)
- [原生模块](./docs/native.md) · [Qobuz / TIDAL 协议引擎](./docs/streaming-rust-guide.md)
- [插件开发](./docs/plugins/) · [插件使用](./docs/plugins-usage.md) · [类型参考](./docs/types.md)
- [硬件发布验收](./docs/hardware-release-checklist.md) · [在线服务验收](./docs/live-provider-acceptance.md)

英文文档在 [`docs/en/`](./docs/en/)。`pnpm docs:dev` 可在本地预览文档站。

## 许可证

[GNU AGPL v3.0](./LICENSE)
