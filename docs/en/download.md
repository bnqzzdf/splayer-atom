---
title: Download and Deployment
---

# Download and Deployment

> Last updated: 2026-11-12

SPlayer Atom ships Linux x86-64 and aarch64 Core artifacts; there is no Desktop installer.
Download prebuilt packages from [GitHub Releases](https://github.com/bnqzzdf/splayer-atom/releases).

| Package | Variants | Notes |
| --- | --- | --- |
| `splayer-atom-core-<version>-<commit>-<date>-linux-x86_64-multi.tar.gz` | `v1` / `v2` / `v3` / `v4` / `zen4` | `v1` is ALSA-only; the others include Diretta |
| `splayer-atom-core-<version>-<commit>-<date>-linux-aarch64-multi.tar.gz` | `arm64` | native aarch64 build with Diretta |

Both packages bundle Node and include the unified `install.sh`:

```bash
tar -xzf splayer-atom-core-*-linux-x86_64-multi.tar.gz
cd splayer-atom-core-*-linux-x86_64-multi
sudo ./install.sh --cpu auto
```

The default install root is `/opt/splayer-atom-core`; existing `data/` is preserved and
systemd/OpenRC is detected automatically. See
[multi-architecture build and installation](./multiarch-build.md) for variants, package layout,
and installer options; see [Core Deployment](./core-deployment.md) for install, upgrade, and
rollback, and [GentooPlayer (OpenRC)](./gentooplayer-openrc.md) for OpenRC hosts.

Single-variant `system-runtime` / `bundled-runtime` tar.gz artifacts can still be built from
source for diagnostics and compatibility testing; Debian 11 final packages carry
`-debian11-without-diretta` or `-debian11-with-diretta-<variant>` suffixes. See
[Build and Packaging](./build-and-packaging.md#debian-11-package).
