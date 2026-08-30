# SPlayer Atom Copilot 指引

所有回答、审查评论与提交摘要使用中文；代码和标识符遵循项目现有语言。

开始前必须以根目录 `AGENTS.md` 为持久规则，以 `docs/atom-roadmap.md` 为产品范围、优先级与验收状态。不要根据本文件维护第二份架构、类型、文件清单或测试计数。

核心边界：Node Core 是数据库、设置、provider session、queue、playback policy、source resolution、cache/preload、统计与 output assignment 的唯一权威；Desktop/Web 是共享 Core Control Protocol 的 Controls；Electron IPC 仅保留 Host capability。Diretta 必须保持严格 Source Direct，不允许静默处理或 fallback。

优先复用上游实现和现有 Core/Control seam。若改动触及多个上游页面/store/service，先停下并重新检查边界。代码注释使用中文，Prettier 使用双引号、分号、100 字符宽与末尾逗号。
