---
layout: home

hero:
  name: "SPlayer Atom"
  text: "Web + Core 音乐播放器"
  tagline: 基于 SPlayer-Next 修改，面向 Linux x86-64 音乐主机，通过浏览器完成日常控制。
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
  - title: 后台 Core
    details: Node Core 负责曲库、队列、在线服务、下载、插件和实际音频播放，浏览器关闭后音乐仍可继续播放。
  - title: Web Control
    details: 电脑、平板或手机浏览器都可以通过 HTTP/WebSocket 连接同一个 Core，并实时同步播放状态。
  - title: HiFi 输出
    details: 支持 ALSA、Diretta Source Direct 与 UPnP Renderer。
  - title: Linux x86-64
    details: 当前唯一正式发布平台，提供 system-runtime 与 bundled-runtime tar.gz artifact。
---

## 产品边界

SPlayer Atom 基于 SPlayer-Next 修改，采用 **Node Core + Web Control** 模式，当前发布目标为 Linux x86-64。

继续阅读：[使用指南](/guide)、[构建与打包](/build-and-packaging)、[Core 部署](/core-deployment)。
