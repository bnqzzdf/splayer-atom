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

- [x] 把现有 remote 调整为：
  - `origin` → SPlayer Atom 自有仓库；
  - `splayer` → `SPlayer-Dev/SPlayer-Next`，fetch-only 用途。
- [x] 建立并维护纯净 `vendor/splayer` 分支；更新时只允许 fast-forward 到 `splayer/dev` 对应官方 commit。
- [x] Atom `dev` / `main` 只跟踪自身 `origin`，不直接跟踪 SPlayer remote。
- [x] 正式记录“Atom 已完成吸收与验收的 SPlayer baseline commit”，不要仅依赖移动的 `splayer/dev`。
- [x] 建立固定的 upstream integration 流程：
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
- [x] upstream touch audit 改为比较稳定的 Atom upstream baseline，而不是直接比较移动的 remote ref，避免一次普通 fetch 改变统计语义。
- [x] 增加 upstream sync CI / 报告，至少能发现：
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

## 4. Desktop / Headless 构建 Flavor 与 Core 边界

当前 `ATOM_HEADLESS=1` / `--headless` 只是运行时模式：虽然不创建 Desktop 窗口，但仍启动完整 Electron runtime。长期产品架构不保留这种“Electron 既是 Desktop 又是 Headless Core”的双重职责。

### 已确定的最终产品模型：Core / Control / Output

SPlayer Atom 采用 Core-centric 架构，参考成熟音乐服务器的职责拆分：**Node Core 是唯一应用与播放权威；Web / Desktop 是 Control；实际音频播放由 Output 执行。**

```text
                         SPlayer Atom Core
                         Node Linux Runtime
                                │
          ┌─────────────────────┼─────────────────────┐
          │                     │                     │
     Library / DB          Playback Domain        Providers
          │              Queue / Policy /         NCM / QM / KG
          │              Source Resolution        Qobuz / TIDAL
          │                     │
          └─────────────────────┼─────────────────────┘
                                │
                         Output Controller
                                │
                 ┌──────────────┴──────────────┐
                 │                             │
         Core Local Output              Future Remote Output
         audio-engine.node              Desktop Output Agent
                 │                             │
          ALSA / Diretta                  local DAC / OS

Controls:
  Web UI ───────────────┐
                        ├──── HTTP / WebSocket ────→ Core
  Desktop Electron ─────┘
```

因此 build flavor 决定的是产品角色与构建图：

- `headless` → **Atom Core**：受支持的 Node 24.x LTS runtime + Core services + Web UI + Core 本机 Output；
- `desktop` → **Atom Control**：Electron UI + Desktop integration + 未来可选的本机 Output Agent，但不拥有 Core playback/domain state。

不建设、也不发布一个长期存在的“Electron Headless”中间产品。当前已经验证的 Electron Headless 只在迁移期间作为行为 oracle；Node Core 完成等价验收后退出正式产品架构。

### Core 的唯一权威职责

以下能力只存在于 Core，不允许 Desktop / Web 建立第二份 authority：

- database / settings domain；
- library / scanner；
- provider session / entitlement；
- playback session / authoritative queue；
- playback policy；
- source resolution / URL refresh；
- song cache；
- preload / gapless scheduling；
- playback recovery；
- lyrics / now playing / play stats；
- output registry / active output assignment；
- Diretta input materialization。

Control 可以缓存这些状态的 UI projection，但只能发送 command 并接受 Core snapshot / event，不得在本地成为播放状态事实来源。

### Desktop 的长期职责

Desktop Electron 降级为控制器，并可在未来增加独立的 Output Agent capability：

- BrowserWindow / UI / preload；
- Core discovery / connection；
- queue、library、provider、settings 的控制与展示；
- global hotkey / tray / desktop notification / protocol 等桌面 integration；
- 可选 Desktop Output Agent。

Desktop Output Agent 即使实现，也只能执行 Core 下发的 `PlaybackJob`：load / play / pause / seek / stop / report status。它复用同一个 `audio-engine`，但不拥有 queue、provider、source fallback、next/prev policy 或 session authority，因此不构成第二套播放器。

若未来提供“单机 Desktop”体验，也应由 Desktop 启动或连接一个 local Core；该 Core 可使用受支持的系统 Node，也可由自包含发行物携带 Node runtime，但不得恢复 Electron renderer/main 自己成为播放 Core。

### Output 演进边界

第一阶段只实现一个 Output：**Core Local Output**。

```text
Core Playback Domain
        ↓
Core Local Output
        ↓
audio-engine.node
        ↓
ALSA hardware / Diretta
```

Remote Desktop Output 属于后续能力，不阻塞 Core 重构。未来远程 Output 传输优先保持原始媒体输入或 Core-controlled ranged media access，由 Endpoint 使用同一 `audio-engine` 解码；当前不引入 Core→Endpoint PCM 流协议，也不实现多 Zone 时钟同步。

初始产品只要求 single active output。多 Zone / grouped synchronized playback 作为远期能力单独评估。

### Headless Node Core Runtime

- [x] 建立独立 Node Core entry，直接启动 Core domain 与现有 HTTP / WebSocket server。
- [x] Core JS 构建图已不依赖 Electron / BrowserWindow；production Core bundle 的 Electron import audit 为 0，进程级 HTTP/session/library smoke 通过。GTK / 最小 native 系统依赖仍由后续 Core-only native flavor 收口。
- [ ] Core 正式支持 **Node 24.x LTS**；首个兼容范围定为 `>=24.18.0 <25`。CI / release 使用一个精确 reference runtime，初始为 `24.18.0`；reference patch 升级必须重新执行 Node/Web/native/Core process/plugin-host 与硬件相关门禁，不允许静默漂移。
- [ ] 系统 Node 与 bundled Node 都使用同一 Core JS / native artifact contract。首阶段优先支持受验证的 system Node 部署；bundled Node 是可选的自包含发行形式，不作为 Core 架构、P1 功能或普通部署的硬前提。
- [ ] 初期不以 Node SEA 为目标；Core 保持可审计、可调试的 JS bundle + native addon 结构。若发布 bundled-runtime artifact，也只是在外层附带 reference Node，不建立第二套 Core 产品。
- [~] `audio-engine.node` 已在本机 Node `24.18.0` 完成 N-API 加载与 Core process smoke；正式 release 继续以 reference Node `24.18.0` 运行自动门禁，不额外维护第二个 Node 24 patch 的兼容 smoke。未来 Desktop Output Agent 若使用同一 addon，再单独验证 Electron runtime 加载。
- [ ] `better-sqlite3` 的 Core native 产物必须在 reference Node 24 runtime 下构建并验证；release staging 不允许被构建机上的任意 Node major 隐式重编。长期 Desktop Control 不应因 Core 数据库而继续依赖 Electron 版 `better-sqlite3`。

Node runtime 的来源属于部署策略，不属于 Core authority 边界：system Node 与 bundled Node 必须运行同一 Core domain、同一 protocol、同一 native compatibility contract，不能因为打包方式不同形成两个产品分支。

### Linux Core Local Output

正式 Headless / Core 默认只支持：

```text
ALSA hardware PCM
Diretta Source Direct
```

- [x] Core native build 通过 `core-audio` flavor 只保留 ALSA，release addon 的 `ldd` 已验证不携带 PipeWire / PulseAudio backend。
- [x] Core native build 只构建 `audio-engine`，不构建 `audio-capture`、`media-ctrl`、taskbar/opencc 等 Desktop native addon。
- [x] `audio-engine` 已使用 Cargo features 拆分 Desktop extras 与 Core `core-audio` flavor，使 Core build 只包含需要的 Linux audio backend。
- [ ] 未来 Desktop Output Agent 可按桌面平台需要构建其 OS output backend，不影响 Core 的最小 Linux 依赖。
- [ ] 要求 Diretta 的正式 Core release 在缺少 Diretta SDK 时明确构建失败，不允许静默生成无 Diretta 能力的同名发行包。

### Runtime-neutral 基础能力

Core 不得依赖 Electron-only infrastructure。需要抽象的边界保持窄而明确，例如：

- `RuntimePaths`；
- `SecretStore`；
- `ApplicationLifecycle`；
- 必要时的 logging adapter。

Provider 凭据属于 Core。Node Core 的 `SecretStore` 在当前单用户专用主机定位下，可优先使用：

- systemd credentials / 部署环境变量；或
- 服务用户专有、权限受限的本地 credential 文件（例如 `0600`）。

Desktop `safeStorage` 最多用于 Control 自身的 Core 连接凭据等 Desktop-local secret，不再作为 provider 登录态的权威存储。

### 迁移里程碑

这些里程碑只是内部检查点，不产生需要长期维护的 Electron Headless 发布产品：

1. [x] runtime-neutral path / fetch / secret / event / playback-presentation / plugin-host seam 已隔离；Desktop renderer 不再拥有 authoritative playback orchestration。
2. [x] Node Core bootstrap 可独立启动 settings、database、song cache、plugin registry、playback session 与 HTTP / WS，并完成 `/api/info`、`/api/session`、`/api/library/count` 及 plugin-host 进程 smoke。
3. [x] 第 5 节定义的 Core-owned playback orchestration 已完成实现层收口：queue / source / policy / recovery / preload / output switching 均由 Core 持有；真实在线连续播放与硬件验收继续单列。
4. [ ] Node Core 完成本地 PCM / Native DSD 播放。
5. [ ] Node Core 完成 ALSA hardware / Diretta 输出与设备切换。
6. [~] Web 播放链已成为 Core Control，浏览器不再拥有 queue / source / recovery / preload authority；完整产品面与长时间断连运行仍待验收。
7. [~] Desktop renderer 已降级为 Core playback Control，但 Electron shell 与 Core 仍同进程组合，尚未完成最终 local-Core / remote-Core 产品形态。
8. [~] Netease session、streaming credential、Qobuz/TIDAL secret 与 plugin runtime 已在 Core/runtime-neutral seam；各 Control 的 provider 登录状态统一投影仍待收口。
9. [ ] 建立支持 Node 24.x LTS 的 Linux Core `tar.gz` 发行：首阶段优先 system Node，随后可增加 bundled Node 自包含变体；二者必须复用同一 Core artifact contract。
10. [ ] Node Core 完整验收后，当前 Electron Headless 退出正式产品架构。
11. [ ] 后续按需求实现 Desktop Output Agent；再评估独立无 UI `atom-output` artifact。

### 验收标准

- 系统中无论同时打开多少 Web / Desktop Control，只有一个 Core queue / playback session / provider session / playback policy authority。
- `headless` build 是运行于受支持 Node 24.x LTS 上的普通 Core，而不是 Electron 的运行参数变体。
- `desktop` build 是 Control；即使未来带 Output Agent，也不复制 Core playback orchestration。
- Core 正式运行时不需要 Electron / Chromium / GTK / PipeWire / PulseAudio。
- 使用 system Node 时，部署环境必须满足并验证 Atom 的 Node 24.x 支持范围；若发布 bundled Node 变体，则它必须使用同一 Core artifact 且固定到 release reference runtime。
- Core Local Output 默认仅为真实 ALSA hardware 与 Diretta。
- Desktop 可连接远程 Core；若提供本机独立使用方式，也通过 local Core 保持相同架构，Node runtime 的来源不改变 Core/Control authority 边界。
- 当前 Electron Headless 在 Node Core 完成前持续作为行为 oracle；最终产品不维护两个 Headless Core。

---

# P1 — Core 播放架构闭环

## 5. Core-Owned Playback & Output Architecture

当前本地 Headless 已经让 main playback session 持有队列；但完整 source resolution、cache policy、在线登录状态判断、next-track preload 等仍有 renderer-owned orchestration。长期目标不是只修复“在线自动下一首”，而是让 **Core 从 canonical `Track` 开始直到 Output 执行播放为止，成为唯一 playback orchestration authority。**

### 已收口的原缺口

- [x] main/Core 拥有唯一 queue / index / repeat / shuffle，并在 Node 与 Desktop runtime 都消费 native `ended` / `sourceError` / Direct boundary。
- [x] `playbackSession.loadIndex()` 已移除“仅 local track”阶段限制。
- [x] 播放用在线 source resolution 已从 renderer `window.api` orchestration 迁入 Core；renderer 旧 resolver 仅保留非 authoritative 兼容用途。
- [x] 在线音质、试听、DJ 跳过、定时关闭、设备切换暂停等会改变实际播放结果的 policy 已迁入 Core authority。
- [x] next-track playable-input preload / Diretta staged next 已由 Core 唯一管理；Control 仅保留歌词/封面 UI 预热。
- [x] URL/source failure 已形成 Core-controlled 的同曲一次 fresh resolve + 有界 skip 策略。
- [x] Desktop renderer 已移除 raw playable-source load path，普通 command、native lifecycle、output switching 与 reload-current 均通过 Core session。

### Core Playback Domain

统一链路收敛为：

```text
Authoritative PlaybackSession
        ↓
Track + PlaybackContext + PlaybackPolicy
        ↓
PlaybackSourceResolver
        ↓
ResolvedPlaybackInput
        ↓
Playback Recovery / Preload / Cache orchestration
        ↓
PlaybackJob
        ↓
Active Output
        ↓
Core Local Output: audio-engine → ALSA / Diretta
```

未来增加 Desktop Output Endpoint 时，也只替换最后的 Output 执行位置，不改变前面的 Core domain。

### PlaybackSourceResolver

- [x] 建立 runtime-neutral 的 Core `PlaybackSourceResolver`，统一处理 local / streaming / NCM / Qobuz / TIDAL，以及上游已存在的兼容 source。
- [x] Resolver 复用现有 main provider API、Qobuz/TIDAL API、plugin router、streaming adapter、song cache 和 Direct materializer，不新增第二套 provider framework。
- [x] QQ Music / 酷狗只保留上游继承所需的 `musicUrl` plugin compatibility seam；未扩大 Atom 对 QM/KG provider、账号、权益或取流逻辑的所有权。
- [x] renderer 不再负责取得“最终可播放 URL/路径”后再交给 Core。
- [x] Queue / persisted session 只保存 canonical `Track` + `PlaybackContext`，不保存会过期的 CDN URL。
- [x] 每次需要播放、reload-current 或 source recovery 时由 Core 根据 canonical Track 获取 fresh source。

Search、浏览歌单、专辑、收藏等 UI 数据查询不必进入 PlaybackSession；单一 authority 边界从“用户选择 canonical Track 开始播放”开始。

### PlaybackPolicy

所有会改变实际播放结果、且在 Control 全部断开后仍必须生效的设置，由 Core 持有，例如：

- 在线音质 `songLevel`；
- 是否允许试听；
- repeat / shuffle；
- active output assignment；
- 与 source cache / preload 直接相关的播放策略。

纯展示设置（主题、字体、侧栏状态、动画等）继续属于 Control。本地 Pinia 可以投影 Core policy，但不能成为 policy authority。

### Provider Session 与登录态

- [~] 播放所需 Provider cookie/token 的权威存储已在 Core/main；Qobuz/TIDAL/streaming secret 已使用 runtime-neutral adapter，但完整 provider session contract 仍待统一。
- [x] Core source resolver 直接使用 main provider session / credential，不以 Web / Desktop `userStore.isLoggedIn` 等 UI 状态决定实际取流。
- [ ] Control 显示的登录状态统一改为 Core provider-session snapshot/event 投影。

### Cache / Direct / Preload 所有权

- [x] song-cache lookup / fetch scheduling 收归 Core，避免多个 Control 重复触发同一缓存任务。
- [x] Diretta 对 HTTP 输入的 exact-byte materialization 完全属于 Core / Output preparation，Control 不需要理解“Diretta 只能加载本地 seekable input”。
- [x] next-track playable-input preload 收归 Core；Control 生命周期不再是 preload owner。
- [x] Diretta `stageDirectNext()` / gapless boundary 的准备、commit 与 temp input 生命周期由 Core 唯一管理。

### Source Recovery

在线 source error 必须区分临时 URL 失效和真正不可播放：

```text
first recoverable source failure
        ↓
invalidate current resolved input
        ↓
re-resolve same canonical Track once
        ↓
resume / restart according to safe recovery semantics
        ↓
repeated failure
        ↓
mark current item failed and advance
```

- [x] 同曲重解析次数有严格上限：非本地 sourceError 最多 fresh resolve 一次，不允许无限 retry。
- [x] entitlement / purchase / trial-policy 等明确不可播放错误不做同曲无意义重试，并进入有界 skip policy。
- [x] Core 负责决定 retry / skip；Control 只接收 error/session/trackLoaded projection。

### Control Contract

Web / Desktop 对播放只发送高层 command：

- select / play track；
- play / pause / seek / stop；
- next / prev；
- queue mutate；
- repeat / shuffle；
- output selection；
- playback policy change。

Core 返回 authoritative snapshot / event。Control 不直接 mutate 权威 queue 后再“同步”给 Core，也不拥有 auto-next、preload 或 source fallback 生命周期。

### Output Contract

Output 不拥有 playlist 或 provider 业务。概念上的 `PlaybackJob` 只要求 Output：

- load；
- play / pause / stop；
- seek；
- report position / duration / state；
- report source / output failure。

第一实现只有 Core Local Output。未来 Desktop Output Agent 继续复用同一个 `audio-engine`，但依然只执行 Core job；因此“Desktop 本机发声”不会重新引入 Desktop player authority。

### 验收标准

- Atom 主动维护的本地、网易、Qobuz、TIDAL、streaming Track 最终都通过同一个 Core playback entry，而不是 renderer-specific load path；QQ/酷狗若由上游能力产生 Track，只要求不破坏现有兼容行为，不作为 Atom 专项验收目标。
- 网易队列至少连续自然播放 3 首，期间关闭所有 Web / Desktop Control 仍继续播放。
- provider URL 过期时可由 Core 对同一 Track 做有限 fresh resolve；失败后再按 policy 跳过。
- next-track preload / Diretta staged next 在无 Control 存活时仍有效。
- 多个 Control 同时连接不会产生重复 queue、重复 source resolution authority 或重复 preload owner。
- Desktop 最终仅为 Control + 可选 Output Endpoint；Web 与 Desktop 使用同一个 Core session。

---

## 6. 输出设备与 Diretta 状态长期一致性

- [x] Web 可在真实 ALSA `hw:*` 与 Diretta 之间切换。
- [x] Web 设备选择以 main 实际 selected device 为权威。
- [x] 多 Web 客户端可同步设备切换结果。
- [x] 在线 HTTP 音源进入 Diretta 前可原字节 materialize 为本地 seekable 输入。
- [ ] 在 main-authority online auto-next 完成后，补充“在线队列 + ALSA / Diretta 切换 + 自动下一首”的组合回归。

---

# P2 — 在线平台与账户能力

Atom 主动开发和验收的在线平台范围收敛为：**网易云音乐、Qobuz、TIDAL**。QQ Music / 酷狗音乐不列入 Atom provider 开发计划；它们只继承 SPlayer 上游已有能力，Atom 不建设独立账号、权益、官方取流或 Diretta 专项适配。

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

## 8. QQ Music（冻结 / 仅继承上游）

### 产品决策

QQ Music 不作为 SPlayer Atom 的主动开发平台。现有相关能力视为 SPlayer 上游兼容面，Atom 不继续扩展其账号、权益、官方取流、缓存策略、Diretta 专项逻辑或产品验收矩阵。

### 后续任务

- [ ] 从 Atom 正式在线搜索界面移除 QQ Music 搜索入口。
- [ ] Atom 默认配置不启用 QQ Music provider / 搜索能力。
- [ ] 保留上游已有实现所必需的兼容代码，不为“清理”而重写或删除上游业务。
- [ ] 上游未来新增 / 修改 QQ Music 能力时，仅做 Atom Core / Control 架构兼容与回归，不主动补充 Atom-specific 功能。
- [ ] 若某项 QQ Music 通用修复适合贡献给 SPlayer，则按 `vendor/splayer` → `contrib/*` 流程单独向上游提交 PR。

### 非目标

- Atom 不开发 QQ Music 登录 / session。
- Atom 不开发 QQ Music VIP / 数字专辑权益解析。
- Atom 不开发 QQ Music 官方播放 URL resolver。
- Atom 不为 QQ Music 单独做 ALSA / Diretta 播放验收；只有上游通用播放链路发生回归时做兼容性检查。

---

## 9. 酷狗音乐（KG / Kugou，冻结 / 仅继承上游）

### 产品决策

酷狗音乐不作为 SPlayer Atom 的主动开发平台。现有搜索、元数据或插件兼容能力只作为 SPlayer 上游继承内容保留，Atom 不继续建设账号、VIP 权益、官方取流或 Diretta 专项能力。

### 后续任务

- [ ] 从 Atom 正式在线搜索界面移除酷狗搜索入口。
- [ ] Atom 默认配置不启用酷狗 provider / 搜索能力。
- [ ] 保留上游已有实现所必需的兼容代码，不主动形成 Atom-owned KG provider 分支。
- [ ] 上游未来新增 / 修改酷狗能力时，仅做 Core / Control 架构兼容与必要回归。
- [ ] 适合上游的通用修复继续通过纯净贡献分支提交，不把 Atom 私有能力带入 PR。

### 非目标

- Atom 不开发酷狗登录 / session。
- Atom 不开发酷狗 VIP 权益解析。
- Atom 不开发酷狗官方播放 URL resolver。
- Atom 不为酷狗单独做 ALSA / Diretta 播放验收；只有上游通用链路变更时做兼容性检查。

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

## 12. 正式产品身份、版本与兼容协议

当前部分 package / builder 元数据仍继承上游 SPlayer Next，仅适合开发阶段。正式发行时 Atom 必须拥有独立产品身份，但 Core / Desktop 继续来自同一 monorepo 与同一 release train。

### 产品身份

- [ ] 确定 Atom 正式产品名。
- [ ] 独立 `appId` / package identity。
- [ ] 独立 Git repository / bugs URL。
- [ ] 独立 artifact name。
- [ ] 独立 update feed / release channel。
- [ ] 禁止 Atom release 错误指向 `SPlayer-Dev/SPlayer-Next` updater / publish。
- [ ] Desktop 安装身份、配置与 updater 不得与 upstream SPlayer 冲突。
- [ ] release metadata 明确记录对应的 `vendor/splayer` upstream baseline commit。

### 版本策略

Core 与 Desktop 使用同一个 Atom 产品版本号，例如：

```text
Atom Version:      0.x.y
Core:              0.x.y
Desktop:           0.x.y
SPlayer Baseline:  <commit>
Atom Commit:       <commit>
```

另行维护独立的 **Core Protocol Version**，产品版本不直接等于协议版本。Control 连接 Core 时必须基于 protocol compatibility 判断是否可用，而不是要求 Core / Desktop 产品版本完全相等。

- [ ] Core 提供正式 version / protocol / capability 信息接口。
- [ ] Desktop / Web Control 根据协议范围与 capability 工作，不通过版本号猜测功能。
- [ ] Core 声明 `diretta`、`netease`、`qobuz`、`tidal`、local library、remote output 等实际 capability。
- [ ] 第一阶段 release channel 只保留 `beta` 与 `stable`；nightly artifact 可作为 CI 产物，但不建立额外正式更新通道。

### 更新策略

- [ ] Desktop 可使用 Atom 自有 updater，但不得消费 SPlayer upstream 更新通道。
- [ ] Core 第一阶段不实现自更新；升级由用户替换新 `tar.gz` release 并按正式升级流程重启服务。
- [ ] Desktop / Core 更新解耦，只要 Core Protocol 兼容即可交叉版本使用。

### 验收标准

- Atom 安装、升级、卸载和发布不会覆盖、冒充或消费 upstream SPlayer 的产品身份与发布通道。
- 任意 Control 连接 Core 时都可以明确判断 protocol compatibility 与 capability。
- release / debug 信息可以准确回答 Atom version、Atom commit、SPlayer baseline、protocol version、arch、Node runtime 与 Diretta capability。

---

## 13. Linux Core 正式部署、数据与升级模型

正式 Core 采用 **portable tar.gz** 分发，不建设 `.deb` / rpm / AppImage 等 Core 安装包。`tar.gz` 解压目录即 Core 安装根目录，并同时作为需要长期保存的业务数据根。

### 正式目录模型

概念布局：

```text
<splayer-atom-core>/
├─ app/                          Core JS / Web 资源
├─ native/                       audio-engine / native dependencies
├─ runtime/                      可选：bundled Node runtime 自包含变体
├─ data/                         需要长期保存的业务数据
└─ service/                      systemd 示例 / 安装辅助文件
```

`data/` 统一保存：

- SQLite database；
- Core settings；
- provider auth / token / session；
- authoritative queue / playback session；
- play stats；
- library configuration 与其他不可随意重建的用户状态。

不再使用 `/tmp/atom-root-home` / `/tmp/atom-root-config` 作为正式数据位置。整个安装目录应可被整体复制、备份和迁移到另一台主机。

### Cache 与日志

- [ ] 可重新生成的 song cache、cover cache、临时 Direct materialization 等使用系统默认 cache 目录，不进入安装目录 `data/`。
- [ ] Linux 优先遵循 `XDG_CACHE_HOME`；未设置时使用当前服务用户的系统默认 cache 位置。
- [ ] 日志优先输出到 stdout/stderr，由 systemd / journald 管理，不在安装目录长期维护独立 log rotation。

### systemd

- [ ] 提供正式 systemd unit / 示例安装脚本，而不是开发阶段 transient service。
- [ ] systemd 明确支持两种等价启动方式：system-runtime 部署指向已验证的 Node 24.x 可执行文件；bundled-runtime 变体指向安装目录内 reference Node。两者启动同一个 Core entry，并在启动/健康信息中暴露实际 Node 版本。
- [ ] 文档化 Diretta Host 的 root 运行要求。
- [ ] service 更新不改变 `data/` 语义，用户替换程序文件时可保留原数据目录。

### Schema Migration / Backup / Rollback

从第一版正式发行前就建立数据 schema version 与 migration 策略：

- [ ] database / durable config 具有明确 schema version。
- [ ] migration 只能由 Core 在已知旧版本 → 新版本路径上执行，并有自动化测试。
- [ ] 升级前至少自动创建一份可恢复的关键数据库 / durable config 备份。
- [ ] 失败 migration 不允许通过“删数据库重建”作为正式恢复路径。
- [ ] release 文档说明升级与回滚步骤，并保留上一版本 Core binary / release 的人工回滚能力。
- [ ] 对不可向下兼容的数据升级，必须在迁移前保留旧版本可恢复副本。

### 验收标准

- 一个 Core 安装目录加上系统 cache 之外，不存在其他隐含业务状态目录。
- 复制完整安装目录到兼容主机后，Core 的 durable state 可按文档恢复。
- cache 删除不会丢失账号、媒体库配置、队列、统计或数据库状态。
- Core 升级失败时，用户可以使用备份和上一 release 恢复，而不是丢弃数据。

---

## 14. 可复现构建、Release Artifact 与 CI

开发机曾出现 Corepack / pnpm store / `node_modules` 文件损坏及 Node 进程随机 SIGSEGV，正式发布不能依赖“失败后重跑”。

### 固定构建环境

- [ ] 建立干净 CI / container release 环境。
- [ ] 固定 **reference Node 24.x patch**（初始 `24.18.0`）、pnpm、Rust toolchain、lockfile、Linux build image 与 Diretta SDK 版本；同时单独维护 Core 的 Node 24.x compatibility range，不能把“支持范围”和“reference build runtime”混成一件事。
- [ ] lockfile + 干净 package store 可重复构建。
- [ ] CI 中分别执行 Desktop / Core flavor 构建；Core runtime、`audio-engine.node`、`better-sqlite3` 与 plugin-host smoke 固定在 reference Node `24.18.0` 上执行。
- [ ] Node / Web / native / touch audit 自动门禁。
- [ ] SDK-enabled Diretta build 使用受控的 SDK provisioning。

### Core Artifact

- [ ] 正式 Core 只发布 `tar.gz`。
- [ ] 首阶段主 artifact 支持系统预装的 `>=24.18.0 <25` Node；启动前或启动时必须明确拒绝不受支持的 Node major/range，而不是带着未知 runtime 继续运行。
- [ ] 可选发布 bundled-runtime `tar.gz`，其中 Node 固定为该 release 的 reference runtime；它只是自包含部署便利形式，与 system-runtime artifact 使用同一 Core JS / native compatibility contract。
- [ ] 首个正式支持架构为 Linux x86-64。
- [ ] ARM64 可构建不等于正式支持；完成真实机器上的 Node/native/ALSA/Diretta/systemd/长时间播放验收后再提升为正式支持平台。
- [ ] release artifact 记录 Atom version、Atom commit、SPlayer baseline、Core Protocol、arch、实际/要求的 Node runtime 与 Diretta capability。

### Release Gate

不能只验证源码 build；必须验证最终 `tar.gz`：

```text
clean Linux environment
        ↓
provide supported system Node
or select bundled-runtime artifact
        ↓
extract tar.gz
        ↓
start Core / systemd
        ↓
version + protocol + Node runtime health check
        ↓
Web Control load
        ↓
library fixture / queue / playback smoke
```

之后在真实音频主机执行 Hardware Release Gate：

- [ ] 真实 ALSA hardware playback。
- [ ] PCM / Native DSD 回归。
- [ ] 真实 Diretta Target 播放。
- [ ] 长时间播放 / auto-next / output switch 回归。

### 验收标准

- 同一 commit 在干净构建环境可稳定生成等价 Core release。
- system-runtime `tar.gz` 在受支持的 Node 24.x 环境可按文档直接运行；若发布 bundled-runtime 变体，则该变体在无系统 Node 的干净环境也必须可运行。
- reference Node `24.18.0` 通过 Core process、`audio-engine.node`、`better-sqlite3` 与 plugin-host smoke；不要求维护第二个 Node 24 patch 的兼容 smoke。
- release 判断以最终 artifact smoke + hardware gate 为准，不以“开发目录 build 成功”代替。

---

## 15. Diretta SDK Release Gate

Diretta SDK 已确认支持 SPlayer Atom 公开 release。后续重点从“能否分发”转为确保 release build 的 SDK 来源、版本和能力一致。

- [x] Diretta SDK 支持公开 release。
- [ ] 明确并固定正式 release 使用的 SDK 版本 / 支持架构。
- [ ] 明确 CI 中 SDK 的安全供应方式，不把 SDK binary / archive 误提交到公开源码仓库。
- [ ] 正式 Core release 要求包含 Diretta 时，缺少 SDK 必须构建失败，不允许静默生成同名 no-Diretta artifact。
- [ ] release metadata 记录 Diretta capability；若 SDK 版本信息允许公开，也记录对应版本标识。

---

## 16. 统一 Atom Control UI

Web 与 Desktop 都是同等级的 Atom Control。长期目标不是维护“Desktop 完整版 + Web 精简版”，而是建立**同一个 Control UI 与同一个 Core Control Protocol**。除运行在 Control 所在机器上的 Host Capability 外，两者在所有 Core Domain 能力上必须对等。

### 产品原则

- Web 不在浏览器本机解码或输出音频，但拥有完整的 Core playback control。
- Desktop 不因使用 Electron 而拥有额外的音乐业务权威；它只是统一 Control UI 加 Desktop Host Capability。
- Web / Desktop 尽量共用同一套 Vue renderer、router、业务组件、Core state projection 与 action model。
- Core Domain 功能不得通过 `isWeb` / `isElectron` 分叉成两套业务实现。
- 若一个功能只有通过 Electron IPC 才能工作、而不能通过正式 Core Protocol 完成，应优先视为 Core / Control 边界尚未收敛，而不是把 Web 永久降级。

### Core Domain 能力：Web / Desktop 必须对等

包括但不限于：

- 媒体库浏览、搜索、专辑、艺术家、歌单；
- 网易 / Qobuz / TIDAL 等 Atom 主动维护 provider；
- authoritative queue 浏览与编辑；
- play / pause / seek / stop / next / prev；
- repeat / shuffle；
- now playing / lyrics / history / stats；
- Core output 浏览、选择与 Diretta 控制；
- library scan 与 Core library path 管理；
- Core playback policy / 音质 / cache policy；
- provider account / token / session 管理；
- Core capability、版本与诊断信息。

Control 本地 store 只保存 Core snapshot / projection，不成为 queue、playback、provider 或 settings domain 的第二事实来源。

### Host Capability：允许按 Control 环境不同

Desktop 可以拥有浏览器不具备的本机集成，例如：

- BrowserWindow / native window control；
- global hotkey；
- tray / desktop notification；
- desktop lyrics / dynamic island / taskbar integration；
- protocol handler；
- 未来 Desktop Output Agent；
- 必要的 OS-native 文件 / shell integration。

Web 可以使用浏览器自己的 notification、clipboard、download 等 Host Capability。Host 能力不同不能导致 Core 音乐业务能力不同。

### Capability-driven UI

- [ ] Core 正式声明可用 domain capability；Control Host 另外声明本地 Host Capability。
- [ ] UI 根据合并后的 capability set 决定显示 / 禁用项目，不在业务组件中散布大量 `isWeb` / `isElectron` 判断。
- [ ] 逐步删除依靠 no-op facade 假装支持的 Desktop-only 设置；不支持的 Host Capability 应隐藏或明确禁用。
- [ ] Desktop 的音乐业务请求最终也通过与 Web 相同的 Core Protocol；Electron IPC 只服务 Desktop shell / Host Capability。

### 统一 Action Model：右键 / 长按 / `...`

右键菜单允许不同 presentation，但业务语义只能有一份。

- [ ] 建立统一 Track / Album / Artist / Playlist 等 Action Model，包括 action id、label、enabled / visible、danger、required capability 与 Core command。
- [ ] Desktop 与 Web 使用同一 Action Model，不分别复制“播放、下一首播放、加入队列、查看专辑/艺术家、收藏、删除”等业务判断。
- [ ] 普通业务菜单优先复用 Vue 自定义菜单以保持 Web / Desktop 一致；只有确实需要 OS native 行为时追加 Desktop-only action。
- [ ] Web 的右键不是唯一入口：触摸设备必须通过 long-press 或 `...` 菜单访问相同 Action Model。

### Core 文件系统与 Control 本地文件系统

Core-centric 架构下必须明确文件属于哪台机器：

- [ ] “添加媒体库目录”浏览和保存的是 **Core 文件系统路径**，Web / Desktop 行为一致，不使用 Desktop 本机 file picker 冒充 Core path。
- [ ] 若未来支持从 Control 本机导入文件，应作为独立的 Upload / Import 功能，由 Control 上传到 Core，而不是混入 Library Folder 设置。
- [ ] “下载到 Core”与“下载到当前 Control 设备”在 UI 与 API 中明确区分。

### Settings 分层

统一设置页应明确区分：

```text
Core Settings
  Library / Playback / Quality / Outputs / Diretta / Providers / Cache / Core Info

This Control
  Theme / Language / Host notifications / Core connection
  Desktop-only: hotkey / tray / desktop lyrics / future local Output Agent
```

Core Settings 在 Web / Desktop 完全对等；This Control 根据 Host Capability 展示。

### 现有 UX 待完善

- [~] Web 本地曲库浏览 / 播放控制 / 搜索已基本可用。
- [x] Web 不显示桌面最小化 / 最大化 / 退出按钮。
- [x] 输出列表已过滤大部分虚拟 / 无效 ALSA 项。
- [ ] 扫描期间显示真实 `scanned / total` 进度，而不仅是最终完成状态。
- [ ] Diretta 在线音源 materialize 时显示明确的“正在准备 Source Direct 音源”反馈。
- [ ] 评估本地搜索扩展到专辑 / 艺术家结果，低于核心播放优先级。

### 验收标准

- 同一个 Core 连接下，Web 与 Desktop 对所有 Core Domain 操作具有等价能力与结果。
- 打开多个 Web / Desktop Control 不会形成不同 queue / settings / provider / playback authority。
- Desktop 退出后 Web 仍可完整管理 Core；Web 关闭后 Desktop 仍管理同一个 Core session。
- 一项新的 Core Domain 功能原则上只需要实现一次 Core contract 与一次共享 Control UI，不需要分别开发 Desktop/Web 业务版本。
- 右键、长按与 `...` 只是同一 Action Model 的不同交互入口。

---

## 17. 文档收口

- [x] 建立本正式 Roadmap。
- [x] 更新 `docs/atom-development.md` 中已经过时的 baseline / test count 描述。
- [ ] 将 `handoff-*` 明确标记为历史阶段快照，不作为当前状态来源。
- [x] 建立正式 upstream sync 操作说明。
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

1. **正式建立 `origin` / `splayer` / `vendor/splayer` upstream sync 工作流。**
2. **直接推进 Node Core + Desktop Control 架构与 compile-time build flavor，不建设可发布的 Electron Headless 中间产品。**
3. **完成 Core-owned playback orchestration：source resolution、policy、recovery、cache、preload / gapless 与无 Control 连续播放。**
4. **以网易作为 reference provider 完成完整 Core 播放闭环回归。**
5. **冻结 QQ Music / 酷狗 Atom 开发：从正式搜索 UI 移除并默认关闭，仅继承和兼容上游能力。**
6. **实现 Qobuz / TIDAL Core 账户能力、Control UI 与真实账号播放验收。**
7. **建立 Atom 独立 release identity、Core Protocol、Node 24.x LTS 支持矩阵 + 精确 reference runtime、安装目录数据模型与正式 Core systemd / `tar.gz` artifact；首阶段优先 system Node，bundled Node 作为可选自包含变体。**
8. **建立统一 Atom Control UI：Web / Desktop Core Domain 能力对等、capability-driven Settings、统一 Action Model，并完善扫描进度与 Direct materialize loading 等 UX。**
9. **Headless 安全增强保留为 P4；仅在产品网络边界发生变化时提前。**

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
