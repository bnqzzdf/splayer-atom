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

当前 Atom 历史基于 SPlayer Next `dev` 持续叠加。长期维护采用“完整 Atom 源码仓库 + 纯净 SPlayer vendor 分支”的模式，而不是把 Atom 当作长期追踪 SPlayer `origin/dev` 的普通 fork。

### 已确定的长期 Git 模型

Atom 仓库本身保存可直接构建、调试、发布的完整最终源码：

```text
Atom repository
= SPlayer upstream baseline
+ Atom delta
```

不采用 Git submodule，也不采用把 SPlayer 搬入子目录的 git subtree / overlay 模型。原因是 Atom 必须修改少量上游 player / queue / main / native seam；若使用 submodule 或 subtree 子目录，将额外引入第二套 Git 历史、patch overlay、路径映射或生成合并树，反而增加维护成本。

远端与分支职责固定为：

```text
origin
  └─ SPlayer Atom 自有仓库，Atom 日常开发 / push / release 的唯一默认远端

splayer
  └─ SPlayer-Dev/SPlayer-Next，仅用于 fetch 上游源码，不作为 Atom push / release 目标

vendor/splayer
  └─ 本仓库内的纯净 SPlayer 上游镜像分支，只允许对应官方 SPlayer commit

dev / main
  └─ 完整 Atom 产品源码
```

关键原则：**remote 只是获取上游源码的运输渠道，`vendor/splayer` 分支才是 Atom 仓库内可审计的上游基线。**

`vendor/splayer` 不允许包含 Atom 代码，不允许 cherry-pick Atom commit，也不允许 merge Atom 分支。它只能 fast-forward 到官方 SPlayer commit，从而长期保持：

```text
vendor/splayer == 某个官方 SPlayer commit
```

### 待开发

- [ ] 把现有 remote 调整为：
  - `origin` → SPlayer Atom 自有仓库；
  - `splayer` → `SPlayer-Dev/SPlayer-Next`，fetch-only 用途。
- [ ] 建立并维护纯净 `vendor/splayer` 分支；更新时只允许 fast-forward 到 `splayer/dev` 对应官方 commit。
- [ ] Atom `dev` / `main` 只跟踪自身 `origin`，不直接跟踪 SPlayer remote。
- [ ] 正式记录“Atom 已完成吸收与验收的 SPlayer baseline commit”，不要仅依赖移动的 `splayer/dev`。
- [ ] 建立固定的 upstream integration 流程：
  1. `git fetch splayer`
  2. fast-forward `vendor/splayer` 到目标 `splayer/dev`
  3. 从 Atom `dev` 创建独立 `sync/splayer-YYYYMMDD` 分支或 worktree
  4. merge `vendor/splayer`
  5. 解决 Atom 与新上游之间的冲突
  6. 检查上游是否已实现某些 Atom patch；若等价则删除下游重复实现
  7. 跑完整自动门禁
  8. 对 player / queue / native / output / main lifecycle 相关上游改动追加真实硬件 smoke
  9. 验收通过后合回 Atom `dev`
  10. 更新正式 Atom upstream baseline commit
- [ ] upstream touch audit 改为比较稳定的 Atom upstream baseline，而不是直接比较移动的 remote ref，避免一次普通 fetch 改变统计语义。
- [ ] 增加 upstream sync CI / 报告，至少能发现：
  - merge conflict；
  - typecheck / tests 回归；
  - touch budget 异常增长；
  - Atom-owned seam 被上游重构后失效。

### 向 SPlayer 上游贡献的规则

若 Atom 开发过程中发现通用 bug 或通用改进，且不依赖 Diretta / Headless / Qobuz / TIDAL / Atom branding 等下游能力，应从纯净 `vendor/splayer` 创建独立贡献分支，例如：

```text
vendor/splayer
      ↓
contrib/fix-xxx
      ↓
SPlayer upstream PR
```

PR 只包含可独立贡献给 SPlayer 的最小改动，不从 Atom `dev` 直接发 PR。上游合并后，后续更新 `vendor/splayer` 时自然重新吸收该修复，并删除 Atom 中已经冗余的 patch。

### 验收标准

- clone Atom 仓库后即可获得完整产品源码，不依赖 `git submodule update`、运行时下载 SPlayer 或构建时 apply patch 才形成最终工作树。
- `origin` 与 Atom 产品身份绑定；SPlayer remote 不再是 Atom 默认 push / release 目标。
- `vendor/splayer` 可被证明等于一个真实官方 SPlayer commit，且不包含 Atom delta。
- 获取上游更新不需要重写已经发布的 Atom 历史。
- 上游更新可以在独立 integration 分支完整验证后再进入 Atom 主分支。
- 普通 `git fetch splayer` 不会让 touch audit 的已验收 baseline 无意漂移。
- 若上游已经提供同等能力，可以安全删除对应 Atom patch，而不是继续维护重复实现。
- 可向 SPlayer 提交干净、独立、无 Atom 私有功能夹带的 PR。

---

## 4. Desktop / Headless 构建 Flavor

当前 `ATOM_HEADLESS=1` / `--headless` 主要是运行时模式。它虽然不创建 Desktop 窗口，但仍运行在完整 Electron runtime 上，无法真正消除 Chromium、Electron lifecycle 与桌面运行栈依赖。

### 已确定的最终方向

不建设、也不发布一个长期存在的“Electron Headless”中间产品。考虑到项目不以尽快发布中间版本为目标，直接向最终 Headless 架构演进：

```text
                         shared application runtime
                        /                          \
Desktop flavor: Electron shell          Headless flavor: Node shell
         ↓                                        ↓
 Electron IPC + Desktop UI                    HTTP / WebSocket + Web UI
                        \                          /
                         same main services
                                ↓
                  library / queue / player / provider
                                ↓
                      ALSA hardware / Diretta
```

Build flavor 决定的是**产品 shell 和构建图**，不是简单裁剪同一个 Electron artifact：

- `desktop` → Electron shell；
- `headless` → Node Linux shell。

当前已验证的 Electron Headless 运行模式在迁移期间保留，作为行为 oracle 和回归参照；当 Node Headless 完整通过同一套功能与硬件验收后，它不再作为正式产品架构的一部分。

### Shared Runtime 边界

以下能力必须保持同一套实现，不因 Desktop / Headless shell 分叉：

- database / settings domain；
- library / scanner；
- playback session / queue authority；
- player / `playerLoad`；
- audio source resolution；
- provider services；
- song cache；
- lyrics / now playing / play stats；
- output-device service；
- Diretta input materialization。

不得因为引入 Node Headless shell 而复制这些业务逻辑。

Electron-only capability 应留在 Desktop shell，例如：

- BrowserWindow / lyric windows；
- IPC / preload；
- global hotkey；
- desktop updater；
- protocol registration；
- tray / desktop media integration；
- taskbar / dynamic-island 等桌面 UI。

两边都需要、但实现依赖 runtime 的能力应通过窄 adapter 提供，例如：

- `RuntimePaths`；
- `SecretStore`；
- `ApplicationLifecycle`；
- 必要时的 logging adapter。

### Headless Node Runtime

- [ ] 建立独立 Node Headless entry，直接启动 shared runtime 与现有 HTTP / WebSocket server。
- [ ] Headless 不依赖 Electron、Chromium、BrowserWindow 或 GTK 桌面运行栈。
- [ ] 正式 Headless 发行包自带项目固定版本的 Node runtime，不依赖用户系统预装的任意 Node 版本。
- [ ] 初期不以 Node SEA 为目标；先使用可审计、可调试的 bundled Node runtime + JS bundle + native addon 结构，稳定后再评估单文件发行。
- [ ] `audio-engine.node` 分别验证 Node runtime 与 Electron runtime 的 N-API 加载兼容性。
- [ ] `better-sqlite3` 分别为 Electron Desktop 与固定 Node Headless runtime 建立正确的 native build / ABI 产物。

### Linux Headless 音频能力

正式 Headless 默认只支持：

```text
ALSA hardware PCM
Diretta Source Direct
```

- [ ] Headless native build 不默认携带 PipeWire / PulseAudio backend。
- [ ] Headless 不构建未启用的 `audio-capture`、`media-ctrl` 等 Desktop native addon。
- [ ] `audio-engine` 使用 Cargo features / capability 拆分，使 build flavor 决定实际 Linux audio backend。
- [ ] Desktop Linux 可继续保留上游需要的 PipeWire / PulseAudio / ALSA 能力。
- [ ] 要求 Diretta 的正式 Headless release 在缺少 Diretta SDK 时明确构建失败，不允许静默生成无 Diretta 能力的同名发行包。

### 迁移里程碑

这些里程碑只是内部重构检查点，不产生需要长期维护的 Electron Headless 发布产品：

1. [ ] 识别并隔离 shared runtime 中所有 Electron-only import / capability。
2. [ ] 提取 runtime-neutral shared bootstrap，同时保持 Desktop Electron 行为不变。
3. [ ] Node Headless entry 可独立启动配置、数据库、媒体库与 HTTP / WS。
4. [ ] Node Headless 完成本地 PCM / Native DSD 播放。
5. [ ] Node Headless 完成 ALSA hardware / Diretta 输出与设备切换。
6. [ ] provider/auth 使用 runtime-neutral path / secret adapters。
7. [ ] 正式 Web UI 在 Node Headless 上完成与当前 Electron Headless 等价的完整回归。
8. [ ] 建立自带固定 Node runtime 的 Linux Headless `.deb` / `tar.gz` 发行。
9. [ ] 全部验收通过后，当前 Electron Headless 运行模式退出正式产品架构，仅在确有调试价值时保留兼容入口。

### Headless Secret Storage 方向

Desktop 可继续使用 Electron `safeStorage`。Headless 在当前单用户专用主机定位下，不强制引入桌面 keyring；优先采用 runtime-neutral `SecretStore`，其 Linux 实现可基于：

- systemd credentials / 部署环境变量；或
- 受限权限的本地 credential 文件（例如服务用户可读、`0600`）。

provider 本身不得直接依赖 Electron `safeStorage`。

### 验收标准

- `desktop` 与 `headless` 是两个明确的 compile-time build flavor，而不是同一个 Electron artifact 的运行参数差异。
- Desktop 继续使用 Electron，且行为与现有 SPlayer / Atom Desktop 保持兼容。
- Headless 正式运行时不需要 Electron / Chromium / GTK / PipeWire / PulseAudio。
- Headless 发行包自带并固定 Node runtime，用户不需要自行维护 Node 环境。
- Headless 默认音频输出仅为真实 ALSA hardware 与 Diretta。
- Desktop / Headless 共享相同的播放器、队列、媒体库、provider、settings 与 source-resolution 业务实现。
- 当前 Electron Headless 在 Node Headless 完成前持续作为已验证行为 oracle；最终产品不需要维护两套 Headless runtime。

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
