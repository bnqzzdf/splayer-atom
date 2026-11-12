# SPlayer Atom 路线图

> 最后更新：2026-11-12

## 当前状态

SPlayer Atom 面向 Linux x86-64 / aarch64，以 Core 和 Web Control 为产品形态；
Node 是默认运行时，Bun 为可选实验 Flavor。

截至 2026-11-05，维护者在最新中文版路线图中将 **40 项开发、修复和验收事项全部勾选为完成**。
已将这些条目按 ALSA／Diretta／UPnP、Provider／Web、文件夹浏览和构建／发布分类迁入
[已完成事项](./history/atom-completed.md)，不再把历史工作放在当前待办清单中。

2026-11-12 发布 `1.3.0`，新增 SACD DST 直通 DFF（UPnP）与 x86/arm64 多架构包；
`1.3.1` 增加 AudioSys 安装适配与网页菜单卡片；`1.3.2` 修复 WAV 中文标签乱码。实现与验收边界见
[SACD DST-DFF 方案](./history/sacd-dst-dff.md)、[多架构构建与安装](./multiarch-build.md)
与 [AudioSys 菜单方案](./history/audiosys-menu-1.3.1.md)、
[WAV 标签乱码修复](./history/wav-gbk-tags-1.3.2.md)。

需要区分「维护者确认完成」与「仓库内存在可独立复核的验收证据」：部分最新勾选的真实硬件、
账号、浏览器、长时间运行及最终发布验收，当前没有与之对应的新报告。
本次只同步项目状态，不重新执行测试，也不以旧产物实测代替 `1.3.2` 的验收证据。
原始测试结论及适用提交、设备、产物范围仍以[历史归档](./history/README.md)为准。

## 后续开发任务

**暂无后续开发任务。**

当前没有继续列入路线图的功能开发、修复或验收待办。出现新需求或缺陷时，
再按实际范围新增任务，不从已完成的历史方案自动恢复待办。

## 版本与发布

- 当前源码产品版本为 `1.3.2`。
- `v1.3.2` 已推送至 GitHub，并在 GitHub Releases 发布 x86-64 与 aarch64 多架构包。
- 发布资产：`linux-x86_64-multi`（v1/v2/v3/v4/zen4）与 `linux-aarch64-multi`（arm64）。
- Node/Bun Runtime Flavor、已有构建记录和限定范围基准见
  [构建形态](./build-flavors.md)及[运行时对照](./history/bun-runtime-experiment.md)。

## 产品范围与约束

当前产品针对可信家庭／局域网中的单用户使用。身份认证、配对、TLS 和更严格的浏览器
来源控制如需引入，应先形成新的产品需求，不视为本轮未完成任务。
长期约束遵循 `AGENTS.md`，开发工作流程见[开发指南](./atom-development.md)。

## 相关文档

| 文档 | 用途 |
| --- | --- |
| [已完成事项](./history/atom-completed.md) | 40 项结项状态、对应实施和历史验收范围 |
| [历史归档](./history/README.md) | 旧方案、实测记录与阶段性结果 |
| [开发指南](./atom-development.md) | 环境、校验与开发约定 |
| [构建与打包](./build-and-packaging.md)、[构建形态](./build-flavors.md) | Core/Web 产物与 Node/Bun Flavor |
| [多架构构建与安装](./multiarch-build.md) | x86 v1/v2/v3/v4/zen4 + arm64 包与安装器 |
| [Core 部署](./core-deployment.md) | systemd、安装、升级和回滚说明 |
| [硬件清单](./hardware-release-checklist.md)、[Provider 验收](./live-provider-acceptance.md) | 验收标准与现存历史记录 |
