---
title: 下载与部署
---

# 下载与部署

SPlayer Atom 只发布 Linux x86-64 Core，不提供 Desktop 安装包。

正式 artifact 有两种部署变体：

```text
splayer-atom-core-<version>-<commit>-<YYYYMMDD>-<HHMMSS>[-diretta-<variant>]-system-linux-x64.tar.gz
splayer-atom-core-<version>-<commit>-<YYYYMMDD>-<HHMMSS>[-diretta-<variant>]-bundled-linux-x64.tar.gz
```

- **system-runtime**：使用系统 Node `>=22.19.0`；
- **bundled-runtime**：包含构建时 reference Node。

两者运行同一个 Node Core 和 Web Control。

获取 artifact 后请按 [Core 部署](/core-deployment) 完成解包、数据目录、systemd、升级与回滚。
