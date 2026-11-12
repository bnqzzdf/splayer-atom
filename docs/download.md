---
title: 下载与部署
---

# 下载与部署

> 最后更新：2026-11-12

SPlayer Atom 发布 Linux x86-64 与 aarch64 Core，不提供 Desktop 安装包。
预编译包从 [GitHub Releases](https://github.com/bnqzzdf/splayer-atom/releases) 获取。

| 包 | 变体 | 说明 |
| --- | --- | --- |
| `splayer-atom-core-<version>-<commit>-<date>-linux-x86_64-multi.tar.gz` | `v1` / `v2` / `v3` / `v4` / `zen4` | `v1` 为 ALSA-only；其余带 Diretta |
| `splayer-atom-core-<version>-<commit>-<date>-linux-aarch64-multi.tar.gz` | `arm64` | aarch64 原生构建，带 Diretta |

两个包都自带 Node runtime，并包含统一的 `install.sh`：

```bash
tar -xzf splayer-atom-core-*-linux-x86_64-multi.tar.gz
cd splayer-atom-core-*-linux-x86_64-multi
sudo ./install.sh --cpu auto
```

默认安装到 `/opt/splayer-atom-core`，保留已有 `data/`；systemd/OpenRC 自动检测。
变体、包结构和安装参数见[多架构构建与安装](./multiarch-build.md)；安装、升级与回滚见
[Core 部署](./core-deployment.md)，OpenRC 目标机见
[GentooPlayer（OpenRC）服务管理](./gentooplayer-openrc.md)。

单变体 `system-runtime` / `bundled-runtime` tar.gz 仍可由源码构建产生，用于诊断和兼容验证；
Debian 11 构建的最终包带 `-debian11-without-diretta` 或
`-debian11-with-diretta-<variant>` 后缀。详见[构建与打包](./build-and-packaging.md#debian-11-package)。
