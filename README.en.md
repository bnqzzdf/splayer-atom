# SPlayer Atom

> Last updated: 2026-10-26

[简体中文](./README.md) · **English**

SPlayer Atom is a music player for Linux hosts, based on [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next).

It runs as a background service and is controlled from a browser on any computer, tablet, or phone on your LAN. Closing the page doesn't stop playback, and every device sees the same playback state. It's meant to live on a music server or HiFi host.

## Features

- **Local library**: folder scanning with incremental updates, album / artist / folder browsing, tag editing, CUE and stereo SACD track splitting
- **Streaming**: NetEase Cloud Music, QQ Music, Kugou, Qobuz, TIDAL
- **Self-hosted servers**: Subsonic, Navidrome, OpenSubsonic, Airsonic, Gonic, LMS, Jellyfin, Emby
- **Lyrics**: LRC, QRC, YRC, KRC, TTML, LyS, SRT, ASS, with word-by-word and bilingual display
- **Audio output**
  - ALSA, with EQ, loudness, and playback speed
  - Diretta: sample rate, bit depth, and channels are sent unchanged and DSD is sent natively, with no processing; formats the target doesn't support fail with an explicit error
  - UPnP renderers
- **Also**: gapless playback, plugins (compatible with LX Music `user_api` scripts), ListenBrainz scrobbling, downloads, listening stats

Atom has no feature for deleting music files. Cleanup only touches its own cache and temporary files.

## Installation

There are no prebuilt packages yet. Build one first as described in [Building from source](#building-from-source) (`out/splayer-atom-core-*-linux-x64.tar.gz`).

The archive extracts directly into the install directory. On a systemd host:

```bash
sudo mkdir -p /opt/splayer-atom-core
sudo tar -xzf splayer-atom-core-*-linux-x64.tar.gz -C /opt/splayer-atom-core
cd /opt/splayer-atom-core

# splayer-atom is a service account you create beforehand; for Diretta use --diretta (runs as root)
sudo ./service/install-systemd.sh --user splayer-atom
sudo systemctl enable --now splayer-atom-core
```

Then open `http://<host IP>:14558` in a browser.

- On OpenRC systems (such as GentooPlayer), use `service/install-openrc.sh`. See [GentooPlayer (OpenRC) service management](./docs/en/gentooplayer-openrc.md).
- If you access Atom through a domain name or reverse proxy, allow that host with `ATOM_ALLOWED_HOSTS`.
- The library, settings, and login credentials live in `data/` under the install directory. Keep it when upgrading. See [Core deployment and upgrades](./docs/en/core-deployment.md) for upgrade and rollback steps.

## Building from source

Requirements:

- Linux x86-64
- Node.js 24.18.0 (the packaging script checks the version; `>=22.19.0` is enough for development)
- pnpm `>=10`
- Rust stable
- ALSA development headers, Clang, pkg-config

System packages on Debian / Ubuntu:

```bash
sudo apt-get install --no-install-recommends -y libasound2-dev pkg-config clang
```

Package:

```bash
pnpm install
pnpm package:core            # uses the host's Node.js
pnpm package:core:bundled    # ships its own Node.js
```

Diretta builds need the Diretta Host SDK and a variant matching the target CPU (`v2` / `v3` / `v4` / `zen4`, see [CPU variants](./docs/cpu-variants.md), Chinese only):

```bash
DIRETTA_SDK_ROOT=/path/to/DirettaHostSDK \
  pnpm exec tsx scripts/atom/build-core-system.ts --require-diretta --diretta-variant=v2
```

See [Build and packaging](./docs/en/build-and-packaging.md) for more options.

## Development

```bash
pnpm install
pnpm dev    # builds debug native modules, then starts the Core and Web dev servers
```

Checks before committing:

```bash
pnpm typecheck && pnpm lint && pnpm test
cargo clippy --workspace --all-targets
cargo test --workspace
```

Layout:

| Directory                  | Contents                                                                     |
| -------------------------- | ---------------------------------------------------------------------------- |
| `core/`                    | Node Core: library, queue, playback control, streaming, HTTP / WebSocket API |
| `src/`                     | Web control UI (Vue 3)                                                       |
| `native/`                  | Rust native modules: audio engine, Qobuz / TIDAL, Diretta SDK bindings       |
| `shared/types/`            | Types shared by Core and Web                                                 |
| `scripts/atom/`, `docker/` | Build and packaging scripts                                                  |

## Documentation

- [Delivery handbook: project / development / operations / user / API](./docs/en/handbook/README.md)
- [User guide](./docs/en/guide.md)
- [Core deployment and upgrades](./docs/en/core-deployment.md) · [GentooPlayer (OpenRC) service management](./docs/en/gentooplayer-openrc.md)
- [Build and packaging](./docs/en/build-and-packaging.md) · [Build flavors](./docs/en/build-flavors.md) · [CPU variants](./docs/cpu-variants.md) (Chinese only)
- [Development setup](./docs/en/atom-development.md) · [Roadmap](./docs/en/atom-roadmap.md) · [Completed work](./docs/en/atom-completed.md)
- [Native modules](./docs/en/native.md) · [Qobuz / TIDAL protocol engine](./docs/streaming-rust-guide.md) (Chinese only)
- [Plugin development](./docs/en/plugins/) · [Plugin usage](./docs/en/plugins-usage.md) · [Type reference](./docs/en/types.md)
- [Hardware release acceptance](./docs/hardware-release-checklist.md) (Chinese only) · [Live provider acceptance](./docs/live-provider-acceptance.md) (Chinese only)

English docs live in [`docs/en/`](./docs/en/). Run `pnpm docs:dev` to preview the docs site locally.

## License

[GNU AGPL v3.0](./LICENSE)
