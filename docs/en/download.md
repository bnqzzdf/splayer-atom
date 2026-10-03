---
title: Download and Deployment
---

# Download and Deployment

> Last updated: 2026-10-03

SPlayer Atom ships only Linux x86-64 Core artifacts. There is no Desktop installer.

Two deployment variants exist:

```text
splayer-atom-core-<version>-<commit>-<YYYYMMDD>-<HHMMSS>[-diretta-<variant>]-system-linux-x64.tar.gz
splayer-atom-core-<version>-<commit>-<YYYYMMDD>-<HHMMSS>[-diretta-<variant>]-bundled-linux-x64.tar.gz
```

- **system-runtime** uses a system Node `>=22.19.0`.
- **bundled-runtime** includes the reference Node used for the build.

Both run the same Node Core and Web Control. Debian 11 bundled builds also retain copies with
`-debian11-without-diretta` or `-debian11-with-diretta-<variant>` suffixes; Diretta is selected
at build time. See [Build and Packaging](./build-and-packaging.md) for the commands.

Follow [Core Deployment](./core-deployment.md) for extraction, data directories, systemd, upgrades and rollback;
on OpenRC targets such as GentooPlayer use [GentooPlayer (OpenRC) Service Management](./gentooplayer-openrc.md) instead.
