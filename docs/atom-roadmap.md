# SPlayer Atom Roadmap

> 状态日期：2026-08-28
>
> 本文是 SPlayer Atom 当前唯一正式的“待开发 / 待验收 / 发布前工作”路线图。历史过程记录见 `progress.md` 与 `docs/handoff-*`，它们不作为当前优先级与完成状态的唯一事实来源。

## 1. 产品定位与长期约束

SPlayer Atom 是基于 SPlayer Next 持续演进的下游版本。目标不是维护一套平行的播放器、媒体库或服务端产品，而是在保留上游架构和 UI 的前提下，增加 Headless Web、Diretta Source Direct，以及 Qobuz / TIDAL 等 Atom 差异能力。

必须长期保持以下约束：

- SPlayer 主进程仍是播放器、队列、媒体库、设置和播放状态的唯一权威。
- Desktop 继续使用 Electron IPC；Web 通过 HTTP / WebSocket 进入同一套 main services。
- 不为 Headless 复制 provider、queue、library、settings 或 playback 业务逻辑。
- Diretta 始终保持严格 Source Direct；不得引入 PCM fallback、DoP、重采样、DSP、DSD→PCM 或静默退出 Direct。
- Linux Diretta Host 的正式实机验收以 root 权限运行。
- 上游业务代码改动保持最小化，并继续由 upstream touch audit 约束。

### 使用环境假设

本产品当前定位为：

- 单用户；
- 仅部署在用户本人控制的主机上；
- 仅在可信局域网内访问 Headless Web；
- 不以公网、多租户或零信任网络为当前产品目标。

因此 Headless API 认证、配对、CSRF 等安全增强列为最低优先级，不阻塞当前功能、构建和发行能力建设。若未来产品定位变为公网或多用户部署，必须重新提升该项优先级。

---

## 2. 优先级定义

- **P0 — 工程基础 / 长期可维护性**：应优先完成，避免后续功能继续扩大维护成本。
- **P1 — 核心产品闭环**：直接影响 Headless 作为独立播放器是否完整可用。
- **P2 — 在线平台与产品能力扩展**：在基础架构稳定后推进。
- **P3 — 发布体验 / UX / 工程质量**：正式发行前完成或持续改进。
- **P4 — 低优先级**：在当前单用户可信局域网定位下不阻塞产品推进。

状态标记：

- `[ ]` 未开始
- `[~]` 已有部分能力，仍需完成
- `[x]` 已完成或已通过当前阶段验收

---

# P0 — 工程基础与长期维护

## 3. 正式建立上游同步机制

当前 Atom 历史基于 SPlayer Next `dev` 持续叠加，下游维护方式需要正式化。

### 待开发

- [ ] 建立清晰的双 remote 模型：
  - `upstream` → `SPlayer-Dev/SPlayer-Next`
  - `origin` → SPlayer Atom 自有仓库
- [ ] Atom 开发分支跟踪自身 `origin`，不再把上游仓库同时作为默认 push 目标。
- [ ] 建立固定的 upstream integration 流程：
  1. `git fetch upstream`
  2. 创建独立 sync 分支或 worktree
  3. merge `upstream/dev`
  4. 解决冲突
  5. 检查哪些 Atom patch 已被上游吸收，可直接删除
  6. 跑自动门禁
  7. 对播放器 / native / output 相关改动追加真实硬件 smoke
  8. 合回 Atom 主开发分支
- [ ] 正式记录“Atom 已吸收的上游基线 commit”，不要仅依赖移动的 `upstream/dev` / `origin/dev`。
- [ ] upstream touch audit 改为比较稳定的 Atom upstream baseline，而不是每次 fetch 后立即改变统计语义。
- [ ] 增加 upstream sync CI / 报告，至少能发现：
  - merge conflict；
  - typecheck / tests 回归；
  - touch budget 异常增长；
  - Atom-owned seam 被上游重构后失效。

### 验收标准

- 获取上游更新不需要重写 Atom 历史。
- 上游更新可以在独立 integration 分支完整验证后再进入 Atom 主分支。
- 一次普通 `git fetch upstream` 不会让 touch audit 的基准无意漂移。
- 若上游已经提供同等能力，可以安全删除对应 Atom patch，而不是继续维护重复实现。

---

## 4. Desktop / Headless 构建 Flavor

当前 `ATOM_HEADLESS=1` / `--headless` 主要是运行时模式；production build 仍会构建大量 Desktop renderer、desktop-only main imports 和 Linux 上不必要的 native 模块。

### Phase A：Headless Electron Build Flavor

- [ ] 引入明确的产品构建 flavor，例如：
  - `desktop`
  - `headless`
- [ ] 增加独立构建入口，例如：
  - `build:linux:desktop`
  - `build:linux:headless`
- [ ] Headless flavor 只构建正式 Web renderer，不构建：
  - desktop lyric renderer；
  - dynamic island renderer；
  - taskbar lyric renderer；
  - 其他仅桌面窗口使用的 bundle。
- [ ] Headless main composition 尽量避免静态引入 desktop-only 模块：
  - BrowserWindow / window shell；
  - global hotkey；
  - desktop updater；
  - protocol registration；
  - desktop media integration；
  - 其他经 import graph 证明 Headless 不需要的服务。
- [ ] `build:native` 支持 flavor，仅构建 Headless 实际需要的 native addon。
- [ ] Linux Headless 包不再默认携带 `audio-capture`、`media-ctrl` 等未启用功能的 native 模块。
- [ ] 为 `audio-engine` 规划 Cargo feature / capability 拆分，避免 Headless 天然携带不需要的 PipeWire / PulseAudio 能力。
- [ ] Headless Diretta release 在要求包含 Diretta 时，缺失 Diretta SDK 应明确构建失败，不允许静默生成无 Diretta 能力的发布包。

### Phase B：Slim Headless Runtime 可行性

- [ ] 评估把 shared main runtime 从 Electron shell 中进一步解耦。
- [ ] 目标形态：

```text
Desktop Electron shell ─┐
                        ├─→ same main services / same player authority
Headless Node shell ────┘
```

- [ ] 评估替代或抽象 Electron-only 依赖：
  - `app.getPath()`；
  - `safeStorage`；
  - Electron lifecycle；
  - protocol；
  - updater；
  - BrowserWindow。
- [ ] 只有在确认不会产生“第二套服务端实现”后，才进入 Slim Headless 实现阶段。

### 验收标准

Phase A：

- Headless artifact 不包含未使用的 Desktop renderer 和无关 native addon。
- Desktop build 行为与上游 SPlayer 保持兼容。
- 同一套 main services 同时服务 Desktop IPC 和 Headless HTTP/WS。

Phase B：

- 若实施，Headless 可以不依赖 Electron / Chromium / GTK 桌面运行栈。
- 不复制播放器、provider、queue、library 或 settings 业务逻辑。

---

# P1 — Headless 核心产品闭环

## 5. 在线播放的 Main-Authority 完整化

当前本地音乐已经由 main playback session 作为权威；在线曲目手动播放已经可以走 provider → source resolution → player，但主进程自然结束后的自动推进仍保留本地音乐阶段的限制。

### 当前缺口

- [~] 浏览器主动选择网易在线曲目可以播放。
- [ ] 在线曲目自然播放结束后，main session 能独立解析并加载下一首在线曲目。
- [ ] `sourceError` 后 main session 能在不依赖浏览器存活的情况下推进到下一首。
- [ ] 浏览器关闭 / 刷新 / 断网后，当前在线队列仍可继续播放。
- [ ] provider URL 失效时由 main 统一做重新解析 / reload，而不是依赖 renderer 生命周期。

### 设计要求

应把 main authority 链路收敛为：

```text
main authoritative queue
        ↓
current Track + PlaybackContext
        ↓
shared provider/source resolver
        ↓
playerLoad
        ↓
normal output / Diretta
```

不得为 Headless 新建第二套 provider resolver 或独立播放器。

### 验收标准

- 网易队列至少连续自然播放 3 首，期间关闭所有 Web 页面仍继续。
- QQ / 酷狗 / Qobuz / TIDAL 后续接入同一套 main auto-next 机制。
- source URL 过期或单首 source error 不会让整个 Headless session 永久停死。

---

## 6. 输出设备与 Diretta 状态长期一致性

- [x] Web 可在真实 ALSA `hw:*` 与 Diretta 之间切换。
- [x] Web 设备选择以 main 实际 selected device 为权威。
- [x] 多 Web 客户端可同步设备切换结果。
- [x] 在线 HTTP 音源进入 Diretta 前可原字节 materialize 为本地 seekable 输入。
- [ ] 在 main-authority online auto-next 完成后，补充“在线队列 + ALSA / Diretta 切换 + 自动下一首”的组合回归。

---

# P2 — 在线平台与账户能力

## 7. 网易云音乐

### 已完成

- [x] Web 搜索。
- [x] 真实登录账号状态可由 main provider session 使用。
- [x] VIP / SVIP 权益曲目可取得真实完整音源 URL。
- [x] VIP 曲目可通过 Diretta Source Direct 播放。
- [x] 已验证 `fee=1` VIP 曲目不是试听 URL。
- [x] 收藏 / 账号相关已有 upstream 能力可读取。

### 待验收 / 待完善

- [ ] main-authority 在线自动下一首。
- [ ] 歌单连续播放。
- [ ] 收藏页 / 日推 / 云盘等 upstream 在线页面的 Headless Web 完整验收。
- [ ] URL 失效后的 main reload。
- [ ] 明确区分真实 `fee=4` 数字单曲购买限制与 VIP 权益解析错误。

---

## 8. QQ Music

- [x] Web provider transport 已接通。
- [x] 搜索可返回结果。
- [ ] 登录状态实际验收。
- [ ] VIP / 数字专辑权限行为验收。
- [ ] 实际音源解析与普通输出播放验收。
- [ ] Diretta Source Direct 播放验收。
- [ ] 歌单 / 收藏 / 自动下一首验收。

---

## 9. 酷狗音乐（KG / Kugou）

- [x] Web provider transport 已接通。
- [x] 搜索可返回结果。
- [ ] 登录状态实际验收。
- [ ] VIP 权益与实际音源解析验收。
- [ ] 普通输出播放验收。
- [ ] Diretta Source Direct 播放验收。
- [ ] 歌单 / 收藏 / 自动下一首验收。

---

## 10. Qobuz

当前已有 Atom-owned Qobuz 底层实现，不应另建 provider framework。

### 已有能力

- [x] Web Player app credential discovery。
- [x] Qobuz API request / signature 基础实现。
- [x] `auth_login` / `auth_status` / `auth_logout` main actions。
- [x] catalog search。
- [x] `track/getFileUrl`。
- [x] canonical SPlayer `Track` 映射。
- [x] Direct 输入 materialization 基础能力。

### 待开发

- [ ] Atom-owned Qobuz 账户设置 UI。
- [ ] 用户输入 `user_auth_token` 后验证并安全持久化。
- [ ] 登录状态展示与退出。
- [ ] 正式 Web 搜索入口恢复 Qobuz。
- [ ] 真实账号 search → queue → playback 验收。
- [ ] 普通输出与 Diretta 双路径验收。
- [ ] main-authority 自动下一首验收。

### 约束

- 不持久化自动发现的 Qobuz app secret。
- 不读取或依赖 qobuz-dl 配置。
- 不新增第二套 URL / song cache。

---

## 11. TIDAL

### 已有能力

- [x] token import / auth status / logout main actions。
- [x] search 基础实现。
- [x] playback manifest 解析。
- [x] DASH Number-based MPD materialization。
- [x] fragmented MP4 / FLAC 本地 decoder proof。
- [x] canonical SPlayer `Track` 映射。

### 待开发

- [ ] Atom-owned TIDAL 账户设置 UI。
- [ ] access token / optional refresh token import。
- [ ] auth status / logout UI。
- [ ] 正式 Web 搜索入口恢复 TIDAL。
- [ ] 真实账号 entitlement 验收。
- [ ] JSON/BTS 与 DASH 两种真实播放路径验收。
- [ ] 普通输出与 Diretta 双路径验收。
- [ ] main-authority 自动下一首验收。

### 延后项

- [ ] 第一方 Authorization Code / PKCE 登录。

该项等待 SPlayer Atom 自有 TIDAL Developer application 与 redirect 配置，不使用历史项目或第三方共享 client credential 作为产品依赖。

---

# P3 — 发布、UX 与工程质量

## 12. 正式发行身份

当前部分 package / builder 元数据仍继承上游 SPlayer Next，仅适合开发阶段。

- [ ] 确定 Atom 正式产品名。
- [ ] 独立 `appId`。
- [ ] 独立 Git repository / bugs URL。
- [ ] 独立 artifact name。
- [ ] 独立 update feed / release channel。
- [ ] 禁止 Atom release 错误指向 `SPlayer-Dev/SPlayer-Next` updater / publish。
- [ ] Desktop 安装身份不得与 upstream SPlayer 冲突。

### 验收标准

Atom 安装、升级、卸载和发布不会覆盖、冒充或消费 upstream SPlayer 的发布通道。

---

## 13. Linux Headless 正式部署包

- [ ] 提供正式 systemd unit，而不是开发阶段临时 transient service。
- [ ] 定义稳定数据目录，例如：
  - `/var/lib/...`
  - `/var/cache/...`
  - `/var/log/...` 或 journald
- [ ] 不再使用 `/tmp/atom-root-home` / `/tmp/atom-root-config` 作为产品数据位置。
- [ ] 明确数据库、provider auth、queue、stats、library config 的备份 / 迁移策略。
- [ ] 提供 `.deb` / `tar.gz` 中至少一种正式 Headless artifact。
- [ ] 文档化 Diretta root 运行要求。

---

## 14. 可复现构建与 CI

开发机曾出现 Corepack / pnpm store / `node_modules` 文件损坏及 Node 进程随机 SIGSEGV，正式发布不能依赖“失败后重跑”。

- [ ] 建立干净 CI / container release 环境。
- [ ] lockfile + 干净 package store 可重复构建。
- [ ] CI 中分别执行 Desktop / Headless flavor 构建。
- [ ] Node / Web / native / touch audit 自动门禁。
- [ ] SDK-enabled Diretta build 使用受控的 SDK provisioning。
- [ ] release artifact 记录 commit、build flavor、arch 和 Diretta capability。

---

## 15. Diretta SDK 分发许可与 Release Gate

技术构建已验证可静态链接 Diretta Linux SDK，但正式公开发布前仍需确认法律 / 授权边界。

- [ ] 确认 Diretta SDK 是否允许在 Atom 发布物中静态再分发。
- [ ] 确认支持的平台 / 架构 / 产品授权限制。
- [ ] 明确 CI 中 SDK 的安全供应方式。
- [ ] 未确认许可前，不把 SDK binary / archive 提交到公开仓库。

---

## 16. Web UX 完善

- [~] 本地曲库浏览 / 播放 / 搜索已基本可用。
- [x] Web 不显示桌面最小化 / 最大化 / 退出按钮。
- [x] 输出列表已过滤大部分虚拟 / 无效 ALSA 项。
- [ ] 扫描期间显示真实 `scanned / total` 进度，而不仅是最终完成状态。
- [ ] Diretta 在线音源 materialize 时显示明确的“正在准备 Source Direct 音源”反馈。
- [ ] Web Settings 逐步采用 capability-based 展示，减少依靠 no-op facade 的桌面-only 项。
- [ ] 评估本地搜索扩展到专辑 / 艺术家结果，低于核心播放优先级。

---

## 17. 文档收口

- [x] 建立本正式 Roadmap。
- [ ] 更新 `docs/atom-development.md` 中已经过时的 baseline / test count 描述。
- [ ] 将 `handoff-*` 明确标记为历史阶段快照，不作为当前状态来源。
- [ ] 建立正式 upstream sync 操作说明。
- [ ] 建立 Desktop / Headless build flavor 与发行说明。

文档职责保持：

```text
docs/atom-roadmap.md      当前未完成事项、优先级、验收标准
docs/atom-development.md  开发环境、构建、维护规则
progress.md               已完成工作的历史记录
docs/handoff-*            阶段 / 会话交接快照
```

---

# P4 — 低优先级：Headless 安全增强

> 当前产品明确定位为单用户、仅可信局域网使用。因此本节不阻塞当前开发、provider 验收、build flavor 或正式本地发行。若未来支持公网、跨不可信网络或多用户，本节必须重新提升至 P0/P1。

当前 Headless 会在 LAN 暴露 Web / HTTP / WebSocket，并包含播放控制、provider session、设置等主机能力。

### 可选后续增强

- [ ] Web 首次配对 / access token。
- [ ] HTTP session authentication。
- [ ] WebSocket authentication。
- [ ] CSRF / Origin policy。
- [ ] 收窄通用 `/config` 为更明确的 capability API。
- [ ] 将 Direct materialize 等内部操作进一步收敛到 main service 内部，减少浏览器可直接调用的高权限通用 endpoint。
- [ ] 若未来取消“可信 LAN”假设，再增加 TLS / reverse proxy 等部署方案。

---

# 18. 建议近期执行顺序

在当前本地播放与网易基本可用的基础上，建议接下来按以下顺序推进：

1. **正式建立 upstream remote / baseline / sync 工作流。**
2. **实现 Desktop / Linux Headless build flavor Phase A。**
3. **补齐在线音乐 main-authority 自动下一首 / source error / 浏览器断开继续播放。**
4. **实测 QQ Music 与酷狗的登录、权益、播放、Diretta。**
5. **实现 Qobuz / TIDAL 账户设置 UI 并做真实账号验收。**
6. **建立 Atom 独立 release identity 与正式 Headless systemd / artifact。**
7. **完善扫描进度、Direct materialize loading 等 Web UX。**
8. **Headless 安全增强保留为 P4；仅在产品网络边界发生变化时提前。**

---

# 19. 当前已完成的重要基线

以下能力不再作为待开发项重复展开，但后续上游同步必须持续回归：

- Headless 正式 SPlayer Web UI 可通过单一 LAN 端口使用。
- `/debug` 工程诊断页保留。
- 本地音乐库扫描 / 浏览 / 搜索。
- PCM / Native DSD 播放。
- Diretta Source Direct 实机播放。
- ALSA `hw:*` / Diretta 输出选择。
- Main authoritative queue / repeat / shuffle 基础架构。
- 本地播放历史 / 统计。
- 网易 / QQ / 酷狗 Web 搜索 transport。
- 网易真实登录 / VIP 取流 / Diretta 播放。
- 在线 HTTP 音源的 Diretta exact-byte materialization。
- Web 输出设备以 main selected device 为权威并支持多客户端同步。

这些能力的目标不是“冻结不动”，而是在后续 upstream integration、build flavor 和 provider 工作中保持单一权威架构并持续通过回归验收。
