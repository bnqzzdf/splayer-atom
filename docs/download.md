---
title: 下载与部署
---

# 下载与部署

SPlayer Atom 只发布 Linux x86-64 Core，不提供 Desktop 安装包。

正式 artifact 有两种部署变体：

```text
splayer-atom-core-<version>-<YYYYMMDD>-<HHMMSS>-system-linux-x64.tar.gz
splayer-atom-core-<version>-<YYYYMMDD>-<HHMMSS>-bundled-linux-x64.tar.gz
```

- **system-runtime**：使用系统 Node `>=22.19.0`；
- **bundled-runtime**：包含构建时 reference Node。

两者运行同一个 Node Core 和 Web Control。

Debian 11 bundled 构建会额外保留带 `-debian11-without-diretta` 或
`-debian11-with-diretta-<variant>` 后缀的包；构建时可选择是否包含 Diretta。
详见[构建与打包](/build-and-packaging#debian-11-bundled-package)。

获取 artifact 后请按 [Core 部署](/core-deployment) 完成解包、数据目录、systemd、升级与回滚。
