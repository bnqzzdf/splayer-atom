---
layout: home

hero:
  name: "SPlayer Atom"
  text: "Web + Core 音乐播放器"
  tagline: 基于 SPlayer-Next 修改，面向 Linux x86-64 / aarch64 音乐主机，通过浏览器完成日常控制。
  actions:
    - theme: brand
      text: 下载
      link: https://github.com/bnqzzdf/splayer-atom/releases
    - theme: alt
      text: 使用指南
      link: /guide
    - theme: alt
      text: Core 部署
      link: /core-deployment
    - theme: alt
      text: GitHub
      link: https://github.com/bnqzzdf/splayer-atom

features:
  - title: 后台 Core
    details: 默认 Node Core 负责本地曲库、队列、下载、插件和实际音频播放，另提供实验性 Bun Flavor；浏览器关闭后音乐仍可继续播放。
  - title: Web Control
    details: 电脑、平板或手机浏览器都可以通过 HTTP/WebSocket 连接同一个 Core，并实时同步播放状态。
  - title: HiFi 输出
    details: 支持 ALSA、Diretta Source Direct 与 UPnP Renderer。
  - title: Linux x86-64 / aarch64
    details: x86-64 提供 v1/v2/v3/v4/zen4 多变体包，aarch64 提供 arm64 包；统一安装器按 CPU 自动选择。
---

> 最后更新：2026-11-12

## 产品边界

SPlayer Atom 基于 SPlayer-Next 修改，采用 **Core + Web Control** 模式，当前目标平台为
Linux x86-64 与 aarch64；Node 是默认正式基线，Bun 是待进一步硬件和稳定性验收的可选 Runtime Flavor。

继续阅读：[交付手册](./handbook/README.md)（项目书 / 开发 / 运维 / 使用 / 接口）、[使用指南](./guide.md)、[构建与打包](./build-and-packaging.md)、[路线图](./atom-roadmap.md)、[Core 部署](./core-deployment.md)、[GentooPlayer / OpenRC](./gentooplayer-openrc.md)。
