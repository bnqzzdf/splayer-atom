---
layout: home

hero:
  name: "SPlayer Atom"
  text: "Node Core + Web Control"
  tagline: Linux x86-64 音乐播放 Core，统一持有曲库、队列、播放策略、在线服务与输出设备。
  actions:
    - theme: brand
      text: 使用指南
      link: /guide
    - theme: alt
      text: Core 部署
      link: /core-deployment
    - theme: alt
      text: GitHub
      link: https://github.com/bnqzzdf/splayer-atom

features:
  - title: Core 唯一权威
    details: 数据库、设置、曲库、队列、播放策略、缓存、下载、插件与在线服务全部由 Node Core 持有。
  - title: Web Control
    details: 浏览器通过 HTTP/WebSocket 控制同一个 Core，不复制播放或数据权威。
  - title: HiFi 输出
    details: 支持 ALSA、strict Diretta Source Direct 与 Core-owned UPnP Renderer。
  - title: Linux x86-64
    details: 当前唯一正式发布平台，提供 system-runtime 与 bundled-runtime tar.gz artifact。
---

## 产品边界

SPlayer Atom 只提供 **Node Core + Web Control**。项目不提供 Desktop/Electron 版本，也不提供 Windows/macOS 应用包。

继续阅读：[使用指南](/guide)、[构建与打包](/build-and-packaging)、[Core 部署](/core-deployment)。
