# SPlayer Atom

SPlayer Atom is a Linux x86-64 music player adapted from [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next). It uses a **Web + Core** architecture: a background Node Core handles the library, online services, playback queue, and audio outputs, while everyday control happens in the browser-based Web Control.

This setup is designed for Linux music servers and HiFi hosts that stay running in the background while you control playback from a computer, tablet, or phone. Closing one browser tab does not stop playback in the Core.

## Product shape

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

## Highlights

- Local library scanning, search, album/artist aggregation, and tag editing
- CUE virtual tracks and SACD stereo virtual tracks
- Netease, Qobuz, and TIDAL providers
- Jellyfin/Subsonic-style self-hosted media servers
- Plugin runtime with LX `user_api` compatibility
- ListenBrainz Now Playing and scrobbling
- ALSA playback
- Strict Diretta Source Direct
  - preserves source PCM rate, channels, effective bit depth, and samples
  - preserves the logical Native DSD one-bit sequence
  - never silently resamples, remixes, applies DSP, or falls back to PCM
- UPnP single-renderer output using the same Core playback queue and source pipeline as local outputs
- Multiple Web Control clients can connect to one Core and stay in sync in real time

## Requirements

- Linux x86-64
- Node.js `>=24.18.0 <25`
- pnpm `>=10`
- Rust stable
- ALSA development headers, Clang, and pkg-config

On Ubuntu/Debian-style systems:

```bash
sudo apt-get update
sudo apt-get install --no-install-recommends -y \
  libasound2-dev pkg-config clang libarchive-tools
```

## Development

```bash
pnpm install
pnpm dev
```

`pnpm dev` builds debug native addons, then starts Node Core and the Web Vite development server.

Common gates:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
cargo check --workspace
cargo test --workspace
pnpm docs:build
```

## Build

```bash
pnpm build
```

The full build:

1. builds `audio-engine.node` and `streaming-api.node`
2. typechecks Node and Web targets
3. builds the Node Core bundle
4. builds Web Control

Individual targets:

```bash
pnpm build:native
pnpm build:core
pnpm build:web
```

## Packaging

System-runtime artifact:

```bash
pnpm package:core
```

Bundled-runtime artifact with the reference Node runtime:

```bash
pnpm package:core:bundled
```

Artifacts are written to `out/`, with the product version and build date in the filename:

```text
splayer-atom-core-<version>-<YYYYMMDD>-system-linux-x64.tar.gz
splayer-atom-core-<version>-<YYYYMMDD>-bundled-linux-x64.tar.gz
```

A formal Diretta build must provide the supported external Host SDK:

```bash
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK \
  pnpm exec tsx scripts/atom/build-core-system.ts --require-diretta
```

## Deployment

System-runtime and bundled-runtime run the same Core/Web application and use the same data layout. See [Core Deployment](./docs/core-deployment.md) for systemd, data directories, upgrades, and rollback.

## Documentation

- [Atom Roadmap](./docs/atom-roadmap.md)
- [Development Setup](./docs/atom-development.md)
- [Build and Packaging](./docs/en/build-and-packaging.md)
- [Build Flavors](./docs/build-flavors.md)
- [Core Deployment](./docs/core-deployment.md)
- [Native Modules](./docs/en/native.md)
- [Hardware Release Checklist](./docs/hardware-release-checklist.md)
- [Live Provider Acceptance](./docs/live-provider-acceptance.md)
- [UPnP Output Plan](./docs/upnp-output-plan.md)

## License

GNU Affero General Public License v3.0. See [LICENSE](./LICENSE).
