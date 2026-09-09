---
title: Download and Deployment
---

# Download and Deployment

SPlayer Atom ships only Linux x86-64 Core artifacts. There is no Desktop installer.

Two deployment variants exist:

```text
splayer-atom-core-system-linux-x64.tar.gz
splayer-atom-core-bundled-linux-x64.tar.gz
```

- **system-runtime** uses a system Node `>=24.18.0 <25`.
- **bundled-runtime** includes the reference Node used for the build.

Both run the same Node Core and Web Control. Follow [Core Deployment](/core-deployment) for extraction, data directories, systemd, upgrades, and rollback.
