---
title: Download and Deployment
---

# Download and Deployment

SPlayer Atom ships only Linux x86-64 Core artifacts. There is no Desktop installer.

Two deployment variants exist:

```text
splayer-atom-core-<version>-<YYYYMMDD>-system-linux-x64.tar.gz
splayer-atom-core-<version>-<YYYYMMDD>-bundled-linux-x64.tar.gz
```

- **system-runtime** uses a system Node `>=22.19.0`.
- **bundled-runtime** includes the reference Node used for the build.

Both run the same Node Core and Web Control. Follow [Core Deployment](/core-deployment) for extraction, data directories, systemd, upgrades, and rollback.
