---
layout: home

hero:
  name: "SPlayer Atom"
  text: "Web + Core music player"
  tagline: Adapted from SPlayer-Next for Linux x86-64 music hosts, with everyday control from a browser.
  actions:
    - theme: brand
      text: User Guide
      link: /en/guide
    - theme: alt
      text: Core Deployment
      link: /en/core-deployment
    - theme: alt
      text: GitHub
      link: https://github.com/bnqzzdf/splayer-atom

features:
  - title: Background Core
    details: Node Core handles the library, queue, providers, downloads, plugins, and actual audio playback, so music keeps playing when a browser closes.
  - title: Web Control
    details: Computers, tablets, and phones can connect to the same Core over HTTP/WebSocket and stay synchronized in real time.
  - title: HiFi outputs
    details: Supports ALSA, Diretta Source Direct, and UPnP Renderer output.
  - title: Linux x86-64
    details: The only supported release target, shipped as system-runtime and bundled-runtime tar.gz artifacts.
---

> Last updated: 2026-10-03

## Product boundary

SPlayer Atom is adapted from SPlayer-Next and uses a **Node Core + Web Control** model. The current release target is Linux x86-64.

Continue with the [User Guide](./guide.md), [Build and Packaging](./build-and-packaging.md),
[Core Deployment](./core-deployment.md), or
[GentooPlayer / OpenRC](./gentooplayer-openrc.md).
