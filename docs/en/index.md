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
    details: The default Node Core handles the local library, queue, downloads, plugins, and playback; an experimental Bun runtime flavor is also available. Music keeps playing when a browser closes.
  - title: Web Control
    details: Computers, tablets, and phones can connect to the same Core over HTTP/WebSocket and stay synchronized in real time.
  - title: HiFi outputs
    details: Supports ALSA, Diretta Source Direct, and UPnP Renderer output.
  - title: Linux x86-64
    details: The only supported release target, shipped as system-runtime and bundled-runtime tar.gz artifacts.
---

> Last updated: 2026-11-05

## Product boundary

SPlayer Atom is adapted from SPlayer-Next and uses a **Core + Web Control** model on Linux x86-64.
Node is the default release baseline; Bun is an optional runtime flavor pending hardware and
long-term stability acceptance.

Continue with the [Delivery Handbook](./handbook/README.md) (project / development / operations / user / API),
the [User Guide](./guide.md), [Build and Packaging](./build-and-packaging.md),
[Roadmap](./atom-roadmap.md),
[Core Deployment](./core-deployment.md), or
[GentooPlayer / OpenRC](./gentooplayer-openrc.md).
