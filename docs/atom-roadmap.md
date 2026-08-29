# SPlayer Atom Roadmap

> 状态日期：2026-08-29
>
> 本文是 SPlayer Atom 当前唯一正式的“待开发 / 待验收 / 发布前工作”路线图。当前执行记录见根目录的 `task_plan.md`、`findings.md` 与 `progress.md`；本地历史快照归档于 Git 忽略的 `history/`，不作为当前优先级与完成状态的事实来源。

## 1. 产品定位与长期约束

SPlayer Atom 是基于 SPlayer Next 持续演进的下游版本。目标不是维护一套平行的播放器、媒体库或服务端产品，而是在保留上游架构和 UI 的前提下，增加 Headless Web、Diretta Source Direct，以及 Qobuz / TIDAL 等 Atom 差异能力。

必须长期保持以下约束：

- Node Core 是播放器、队列、媒体库、设置、provider session、播放策略与播放状态的唯一业务权威。
- Desktop 与 Web 都是 Control；音乐业务请求共用正式 Core Control Protocol，Electron IPC 仅保留 Desktop Host Capability 与明确未收口的本机事件边界。
- 不为 Desktop 或 Headless Web 复制 provider、queue、library、settings 或 playback 业务逻辑，也不建立第二套 Control 权威状态。
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
- [~] Core 已定义并在启动前强制 **Node 24.x LTS** 兼容范围 `>=24.18.0 <25`，reference runtime 固定为 `24.18.0`；本地正式 artifact pipeline 已只接受该 reference Node。干净 CI / release workflow 尚未接入，reference patch 升级仍必须重新执行完整门禁。
- [~] system-runtime artifact 已使用同一 Core JS / native contract；统一 launcher 同时支持系统 `node`、显式 `ATOM_NODE_BIN` 与未来 `runtime/bin/node`。bundled Node artifact 尚未实现，但它不是 Core 架构或 P1 功能前提。
- [x] 初期不以 Node SEA 为目标；Core 已保持可审计、可调试的 JS bundle + native addon 结构，system-runtime staging 不依赖 SEA 或单文件封装。
- [x] `audio-engine.node` 已在 reference Node `24.18.0` 下完成 release N-API load、Core process 与最终 tar artifact smoke；按当前决策不额外维护第二个 Node 24 patch smoke。未来 Desktop Output Agent 若使用同一 addon，再单独验证 Electron runtime 加载。
- [x] `better-sqlite3` 的 Core runtime 只在 reference Node `24.18.0` artifact pipeline 中验收；staging 直接携带已验证的 Linux x64 N-API prebuild，不执行 `pnpm/npm install` 或隐式 native rebuild。

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
8. [~] Netease session、streaming credential、Qobuz/TIDAL secret 与 plugin runtime 已在 Core/runtime-neutral seam，Netease/Qobuz/TIDAL 登录状态也已统一由 Core snapshot/event 投影；Qobuz/TIDAL Account UI 与真实账号验收仍待完成。
9. [~] 已建立 Node 24.x LTS system-runtime Linux x64 `tar.gz` 技术 artifact、统一 launcher 与 final-artifact smoke；正式 release identity / CI 发布链、硬件 gate 与可选 bundled Node 变体仍待完成。
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

- [x] 播放所需 Provider cookie/token 的权威存储已在 Core/main；Qobuz/TIDAL/streaming secret 使用 runtime-neutral adapter，Netease/Qobuz/TIDAL 的 call、session snapshot、logout 与 manual-cookie auth 已统一为正式 Core Protocol；embedded login window 仅作为 Desktop Host capability，session push 复用统一事件投影。
- [x] Core source resolver 直接使用 main provider session / credential，不以 Web / Desktop `userStore.isLoggedIn` 等 UI 状态决定实际取流。
- [x] Control 登录状态已统一改为 Core `ProviderSessionsSnapshot` + Desktop/WS event 投影；Netease `user.isLoggedIn` 不再由 renderer profile 是否存在推断，Qobuz/TIDAL 后续账户 UI 复用同一非持久化 projection store。

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

- [x] Atom 正式在线搜索界面已移除 QQ Music 搜索入口；历史持久化 QQ 搜索偏好进入 Search 时归一到网易。
- [x] Atom 默认搜索平台保持网易；正式 Desktop 搜索平台只暴露 Netease/Qobuz/TIDAL，当前 Web 只暴露 Local + Netease。
- [x] QQ Music 底层 search/collection/lyric/plugin playback compatibility 保持上游兼容实现，不因产品入口冻结而删除或重写。
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

- [x] Atom 正式在线搜索界面已移除酷狗搜索入口；历史持久化 KG 搜索偏好进入 Search 时归一到网易。
- [x] Atom 默认搜索平台不启用酷狗；正式 Desktop/Web 搜索平台集合均不包含 KG。
- [x] 酷狗底层 search/collection/lyric/plugin playback compatibility 保持上游兼容实现，不形成新的 Atom-owned KG provider 分支。
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

- [x] Atom-owned Qobuz 账户设置 UI 已接入现有 Services settings schema，Desktop/Web 共用同一组件。
- [x] 用户输入 `user_auth_token` 后复用现有 `auth_login → user/get` 验证，再由 Core 安全持久化；Control 不持久化 token。
- [x] 登录状态展示与退出复用 Core `ProviderSessionsSnapshot` / `clearSession`。
- [x] 正式 Web provider/search surface 已恢复 Qobuz，并继续与 QQ/KG 冻结边界分离。
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

- [x] Atom-owned TIDAL 账户设置 UI 已接入现有 Services settings schema，Desktop/Web 共用同一组件。
- [x] access token / optional refresh token + client id import 复用现有 `auth_import → /sessions` 验证后由 Core 持久化；Control 不持久化 token。
- [x] auth status / logout UI 复用 Core `ProviderSessionsSnapshot` / `clearSession`。
- [x] 正式 Web provider/search surface 已恢复 TIDAL；未登录时由既有 API 错误语义返回，不由 Control 伪造会话。
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

- [~] Core `/api/info` 已提供 shared Core Protocol v1 与 capability contract，Node/runtime 信息也已纳入；正式 Atom 产品 version/commit/SPlayer baseline identity 仍待产品身份工作补齐。
- [~] Web Control 已在所有 domain HTTP/WS 工作前按 shared protocol range 拒绝不兼容 Core，不再用产品版本号猜 API；Desktop/remote-Control capability-driven UI 仍待后续统一 Control 工作。
- [x] Core 已声明 `library`、`playback`、`download`、`diretta`、`netease`、`qobuz`、`tidal`、`remoteOutput` capability；其中 Diretta 从当前 native `build.json` 读取，no-SDK artifact 明确报告 false。
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

- [x] Core production 的 song cache、cover cache、临时 Direct materialization 等可重建数据使用独立 cache 根，不进入安装目录 `data/`；staged-process smoke 已验证 `data/` 下无 `cache/`。
- [x] Linux Core 优先遵循 `XDG_CACHE_HOME`；未设置时默认使用当前服务用户的 `~/.cache/splayer-atom`。
- [x] Core production 的 JS logger 与 native audio logger 已切为 stdout/stderr-only，不在安装目录创建 `logs/`；Desktop 原文件日志行为保持不变。

### systemd

- [x] artifact 已携带 systemd unit、统一启动 wrapper、显式 ALSA-user / Diretta-root 安装 helper 与完整 Core 运维指南；helper 根据实际解压目录生成 unit，不自动 enable/start 服务。
- [x] 同一 launcher 支持 system-runtime 的系统 Node / `ATOM_NODE_BIN`，并预留 `runtime/bin/node` 给未来 bundled-runtime；两种方式最终执行同一个 `app/index.js`，Core `/api/info` 暴露实际 Node 版本与支持范围。
- [x] systemd 安装要求显式选择普通 ALSA Core 的既有非特权服务用户或 Diretta Host root 模式；部署文档记录对应权限与诊断边界。
- [x] Core durable state 固定到安装根 `data/`；升级流程完整保留上一安装目录并复制旧 `data/` 到新 release，回滚恢复上一 binary + pre-upgrade data，不要求旧 Core 读取已迁移 schema。

### Schema Migration / Backup / Rollback

从第一版正式发行前就建立数据 schema version 与 migration 策略：

- [x] database / durable config 具有明确 schema version，并写入 `runtime.json` 由最终 artifact gate 验证。
- [x] migration 只能由 Core 在已知旧版本 → 新版本路径上执行；未知未来版本在 store/database 加载前拒绝，已知 SQLite migration 有事务回滚测试。
- [x] 既有 durable state 需要 schema migration 时，Core 在迁移前自动创建可恢复数据库 / durable config snapshot；SQLite 使用 `VACUUM INTO` 保留 WAL 已提交状态，新安装不创建空备份。
- [x] 失败 migration 不允许通过“删数据库重建”作为正式恢复路径；事务失败保持旧 schema/version，运维指南明确禁止删除数据库绕过迁移失败。
- [x] release 运维指南说明安装、升级与回滚步骤，并要求保留上一完整 Core 安装目录直到新 release 验收通过。
- [x] 对不可向下兼容的数据升级，升级流程先保留旧 binary + pre-upgrade `data/`，Core 迁移前再创建 schema snapshot；旧 release 回滚不读取新 schema。

### 验收标准

- 一个 Core 安装目录加上系统 cache 之外，不存在其他隐含业务状态目录。
- 复制完整安装目录到兼容主机后，Core 的 durable state 可按文档恢复。
- cache 删除不会丢失账号、媒体库配置、队列、统计或数据库状态。
- Core 升级失败时，用户可以使用备份和上一 release 恢复，而不是丢弃数据。

---

## 14. 可复现构建、Release Artifact 与 CI

开发机曾出现 Corepack / pnpm store / `node_modules` 文件损坏及 Node 进程随机 SIGSEGV，正式发布不能依赖“失败后重跑”。

### 固定构建环境

- [x] 独立 `Core System Gate` 已在干净 GitHub `ubuntu-24.04` runner 上完成首次真实 clean run：2026-08-29 对 commit `fd5671f` 的 Actions run `33245921866` 全部 step PASS。
- [x] Core CI 固定 reference Node `24.18.0`、Rust `1.98.0`、Ubuntu 24.04，并由 `packageManager` / frozen lockfile 固定 pnpm 依赖来源；Core 的 Node 24.x compatibility range 与 reference build runtime 保持分离。
- [x] Core CI 使用 ephemeral runner + `pnpm install --frozen-lockfile` 从干净 package store 构建；首次 hosted clean run 已验证该环境与依赖策略可实际完成 artifact 全链。
- [x] upstream Desktop CI 保持原流程，Atom `Core System Gate` 独立构建 Core flavor；Core runtime、`audio-engine.node`、`better-sqlite3` 与真实 plugin-host `hostReady → ping → pong` smoke 已在 reference Node `24.18.0` hosted artifact pipeline 通过。
- [x] Core artifact pipeline 已串联 native release、Core JS、plugin-host IPC smoke、Web、Electron/external dependency audit、staging 与最终 tar smoke；Node/Web/type/lint/touch、部署面与 whitespace 门禁均在首次 GitHub-hosted run 通过。
- [~] SDK-enabled Diretta build 的受控 provisioning 已落实为独立手动 `Core Diretta Release Gate`：只运行在 `self-hosted/linux/x64/diretta-sdk-149` 受控 runner，SDK 149 只读预置在 checkout 外 `/opt/diretta/HostSDK_149`，不进入 GitHub Secrets / repository / Actions artifact / release upload。`diretta-release` Environment 已创建并仅允许 `dev` 部署；首次远端执行现在只缺受控 runner 注册。

### Core Artifact

- [~] 已能稳定生成 deterministic system-runtime `tar.gz` 技术 artifact；正式 release channel / artifact identity 尚未接入，因此不提前宣称正式发布完成。
- [x] system-runtime artifact 支持系统预装 `>=24.18.0 <25` Node，Core 在加载 database/native/plugin 之前明确拒绝不受支持 runtime；artifact pipeline 本身固定在 reference Node `24.18.0`。
- [ ] 可选发布 bundled-runtime `tar.gz`，其中 Node 固定为该 release 的 reference runtime；它只是自包含部署便利形式，与 system-runtime artifact 使用同一 Core JS / native compatibility contract。
- [~] 当前 Core native、staging 与 artifact pipeline 均显式限定 Linux x86-64；提升为“正式支持平台”仍需真实 ALSA/Diretta/systemd/长时间播放 hardware gate。
- [ ] ARM64 可构建不等于正式支持；完成真实机器上的 Node/native/ALSA/Diretta/systemd/长时间播放验收后再提升为正式支持平台。
- [~] 当前 `runtime.json` 已记录 arch、Node range/reference、`better-sqlite3`、Core Protocol 与完整 capability snapshot，并由 final-artifact gate 与 `/api/info` 做一致性校验；Atom version/commit、SPlayer baseline 尚待正式 release identity 工作补齐。

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

当前自动化在打包前以 reference Node 对 production `plugin-host.js` 执行 `hostReady → ping → pong` IPC smoke，再对最终 `tar.gz` 执行 `extract → launcher → /api/info → /api/session → /api/library/count → Web root → SIGTERM`。artifact 同时携带 deployment guide/systemd installer；重复 staging 的 deterministic archive 约束仍保留。真实 playback 与硬件仍不由这些 smoke 代替。

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
- [x] 首个正式 Core release 固定 **Diretta Host SDK 149 + Linux x86-64**。构建从 SDK 自带 `Host/Release.hpp` 读取 `ReleaseNo` 并在编译前拒绝非 149；AArch64 只保留当前 native compile capability，不在真实机器 release gate 完成前声明正式支持。
- [x] CI 中 SDK 的安全供应方式已明确并代码化：SDK-enabled gate 仅手动运行在受控 self-hosted `diretta-sdk-149` runner，SDK 149 只读预置于 checkout 外固定路径；普通 GitHub-hosted CI 永不接触 SDK，workflow 也不上传 SDK/source/archive。
- [~] `diretta-release` Environment 已创建并配置 `dev`-only deployment branch policy；仍需注册首台受控 `diretta-sdk-149` release runner 后执行首次远端 SDK-enabled `--require-diretta` gate。
- [x] 正式 Core release 要求包含 Diretta 时必须使用 `--require-diretta`；缺少 `DIRETTA_SDK_ROOT` 会在清理/编译前失败，不允许静默生成同名 no-Diretta artifact。
- [x] native `build.json` 与最终 `runtime.json` 同时记录 Diretta capability 与 `direttaSdkRelease`；SDK-enabled artifact 已实构建记录 149，no-Diretta artifact 记录 `null`。

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

- [x] Core 已通过 `/api/info` 正式声明 domain capability；Control renderer 另外用 Atom-owned `ControlHostCapability` 声明 window controls / desktop lyric / hotkey / tray / native file-dialog / protocol 与浏览器侧 Host 能力，不把这些能力混进 Core Domain。
- [x] UI 已按 capability 决定已审计 Host-only presentation：播放器桌面歌词入口使用 `desktopLyric`；Settings 在统一 schema 入口隐藏 Desktop-only External Lyric / Hotkeys，General 按 `windowControls` / `desktopUpdater` / `nativeFileDialogs` 隐藏 Desktop shell、updater 与配置文件 Host section，About 按 `desktopUpdater` / `hostLogDirectory` 隐藏 Desktop-only action；Netease Electron embedded-login 只在 `providerLoginWindow` 下展示，系统字体枚举只在 `systemFonts` 下启用。Download 已完成文件位置 action 的 `hostFileExplorer` gating，歌词海报导出在 Web 使用 `browserDownload`，window/updater/settings store 也不会在 capability 缺失时初始化 Desktop facade。
- [x] 已完成当前共享 UI 的 no-op facade 可达性审计：External Lyric / Hotkeys、General 的 Desktop window/taskbar/protocol/close、updater、Electron config import/export/reset，以及 About 的 Desktop updater/log-directory 行为均从 Web 普通能力面移除；Appearance、本地封面 picker、embedded-login、系统字体枚举、文件管理器定位均按真实 Host capability 隐藏。Cache/Download/Library/Comments/network proxy/audio-output reinit 均走真实 Core 实现；歌词海报导出在 Web 使用 browser download；`useWindowControls`、updater store 与 Desktop lyric/window settings subscriptions 不再在 Web 初始化 no-op facade。保留在 Web API 中的 no-op/unsupported 字段仅用于 Electron API shape 兼容或冻结的非 Atom provider surface，不作为产品能力展示。
- [~] Desktop 的音乐业务请求逐步迁移到与 Web 相同的 Core Protocol；当前已完成十五条 renderer transport / projection 切片：play / pause / stop / seek；authoritative session/queue（恢复、legacy migration、replace/append/insert/remove/select/move、repeat/shuffle、Personal FM、auto-close）；player processing/status（volume、speed/pitch、normalization、EQ、fade、status snapshot）；output discovery/selection；Atom-managed Provider（Netease/Qobuz/TIDAL call、session snapshot、logout、manual-cookie auth）；Library request（曲库读取/搜索/随机、scan/scan-root mutation、标签/文件 mutation、artist avatar）；分散 Player helper（FFT enable/read、当前高清封面、外部歌词文件读取）；首批统一 Core Domain event projection（Provider session、Library scan progress、Download state/progress）；低频 Player projection（status、trackLoaded、session、deviceChanged、error）；高频 Player projection（position、fftData）；Web 退出 legacy Player event transport（Web 仅订阅 CorePlayerProjectionEvent，legacy player:event 只保留 Desktop Host directive 与 recovery fallback）；Download request/mutation（start/retry/startMany/list/cancel/remove/clearFinished/getDir/setDir/resetDir）统一走 `downloadClient`；Playlist request/mutation（list/get/create/update/remove/addTracks/removeTracks/importLegacy/clear）统一走 `playlistClient`；Stats ownership/transport：Desktop/Node 的 play stats 由同一 Core native lifecycle 计时与 shutdown flush，renderer 第二统计会话及 `stats:recordPlay` 写入口已删除，summary/library/top/daily/hourly 与 favorite mutation 统一走 `statsClient`；以及 Cache management（stats/clear/clearAll/getDir/setDir/resetDir）统一走 `cacheClient`，Desktop native picker 只返回经 Core path validation 的目录，不再直接执行 `switchCacheDir()`。Desktop 内部 `atom-core://control` 与 Headless Web 都挂载同一个 `buildCoreControlRoutes()`，该 router 组合现有 `buildHeadlessRoutes()` 与 retained thin `buildAtomCompatRoutes()`，不复制业务 route。共享 `CoreControlEvent` envelope 由 Desktop 单一 `core:event` IPC subscription 与 Web 现有单一 WS 承载；同一 `controlEventClient` 负责 typed subscription 与 Web asset projection。旧 `apis:sessions` / `library:scanProgress` / `download:state` / `download:progress` channel 与对应 domain callback 已从生产代码移除，Player projection（status、trackLoaded、session、deviceChanged、error、position、fftData）均不再从 `player:event` 生产；Desktop 继续在 native event source 对 position/FFT 做可见窗口 gating，Web WS 继续由现有高频事件门禁过滤 position/FFT，因此统一 envelope 不增加远端高频带宽。Library 的 `pickScanDir` / `pickCoverImage`、Download 的 `pickDir` 与 Cache 的 `pickDir` 继续明确保留为 Host action；Download `pickDir` 只负责 native directory picker 与 Core path validation，不再直接写 Core 配置，选择结果统一经 `downloadClient.setDir()` mutation。QQ/酷狗 `call` 只保留 frozen upstream compatibility IPC，Netease embedded-login 继续是 Host capability。Player renderer 侧 `syncPlayMode` / `syncLikeState` 已确认只是 tray/thumbar Host presentation；旧 `player:event` 现在只保留 Desktop tray/system-media Host command directive，以及 ended/sourceError/directTrackBoundary 未被 Core 消费时的 Desktop recovery fallback；Web 不再订阅该 legacy channel，recovery handler 因而不再需要 `isWebRemote()` 运行时分支。request-style Player IPC 已无活跃调用者。Web 的 ALSA 过滤与 Diretta 显示名保留在 Control projection，不下沉成 Core policy。renderer-facing Direct stage/cancel/commit/materialize API 与 renderer Direct preload result/generation 第二状态机已删除，Direct input materialization、staging 与 gapless boundary commit 只剩 Core 内部实现。该内部协议不依赖默认关闭的 external API、不新增 LAN listener。Playlist 仍复用唯一的 upstream `usePlaylistStore`；旧 IndexedDB 只作为一次性迁移输入，导入 mutation 进入同一 Core contract，Web 不再维护第二份 route mapping。播放统计现在由 Core 单独拥有：同一曲目 source recovery 继续延续会话，自然结束/下一曲切换结算，Desktop 与 Node Core 退出前都会刷出最后一段有效统计，Control 数量不再影响 `play_history`。Cache 管理也只保留一个 Core mutation authority：`POST /cache/dir` 先验证真实 Core 目录再调用既有 `switchCacheDir()`，Web facade 复用同一 client；`audioSource.ts` 中仍存在的 song-cache lookup/fetch/cancel 仅属于冻结/兼容播放内部 seam，不扩成 Web Control API。第十五条切片验证基线为 Node 248/248、Web 75/75、touch audit 91 / 22 / 13 与 Desktop production build PASS。未被 Core 消费的 recovery fallback 保持 Desktop-only legacy resilience seam，不作为 Web/Core authority projection；Desktop shell / Host Capability directive 最终保留 IPC。后续继续审计 Lyrics/NowPlaying/Streaming 等仍可能通过 Desktop facade 发起的 Core Domain request。

### 统一 Action Model：右键 / 长按 / `...`

右键菜单允许不同 presentation，但业务语义只能有一份。

- [x] 已建立共享 `ControlAction` 语义模型，包含 action id、label、enabled / visible、danger、required capability 与可选 Core command；Track、Collection detail（playlist/album）与 Artist 已接入，且共用一份 Action→Vue menu adapter。
- [x] Track 的 Desktop / Web 右键与 `...` 入口消费同一 action list；Collection 的播放/收藏/管理/overflow 与 Artist 的播放/收藏/overflow 也分别由单一 action list 驱动，不再在 presentation 层复制 enabled / visible 判断。Favorites 的 playlist/album/artist cover card 也通过同一模型提供真实的取消收藏动作。
- [x] 普通业务菜单复用现有 Vue `SContextMenu` / `SDropdownMenu` presentation；`showInExplorer` 仅以 `hostFileExplorer` Host action 出现。Track、Collection / Artist detail 与可选 CoverList card action 共用同一 Action→menu adapter，通用 cover 组件不拥有 provider 业务语义。
- [x] Track 已提供行内 `...` 入口供触摸/无右键环境访问同一 Action Model，Collection / Artist detail 也已有共享 overflow 入口；Favorites 的 Album / Artist / Playlist CoverList 卡片在存在真实二级动作时显示同模型 `...`。纯导航 CoverList 调用保持 click-only，不为了形式完整制造空菜单。

### Core 文件系统与 Control 本地文件系统

Core-centric 架构下必须明确文件属于哪台机器：

- [x] “添加媒体库目录”浏览和保存的是 **Core 文件系统路径**：Web 使用共享 Core directory browser，Desktop 同机 native picker 只是 Host presentation；两条路径最终都经 Core directory validation，不把 Control 本机路径冒充远端 Core path。
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
- [x] Web 的 Library 与 Download 路径选择使用共享 Core directory browser，可逐级浏览或显式输入 Core 路径；Core 只返回目录并验证真实目录存在，浏览器本地文件系统不会混入 Core path。
- [x] Web 不显示桌面最小化 / 最大化 / 退出按钮。
- [x] 输出列表已过滤大部分虚拟 / 无效 ALSA 项。
- [x] Web / Desktop 扫描期间复用 Core scanner 的同一 `ScanProgress`，实时变化通过共享 `CoreControlEvent` envelope 投影，HTTP snapshot 仅保留为 Core 状态读取/诊断入口；不再用 0/0 合成进度，也不新增第二扫描状态机。
- [x] Desktop/Web 共用的 `switchDevice()` Control 命令在在线 Track 切入 Diretta 且 Core 尚未完成时显示“正在准备 Source Direct 在线音源”loading 反馈；反馈复用现有已触碰命令层，Control 不直接调用 materialize，也不新增 selector 状态或上游 touch。
- [x] Desktop/Web 搜索统一暴露本地来源，并复用现有 Library API 扩展到 songs / albums / artists；本地 playlist 搜索仍不伪造，Qobuz/TIDAL 继续按已实现能力保持 songs-only。

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
- [x] `handoff-*` 已明确标记为历史阶段快照，不作为当前状态来源。
- [x] 建立正式 upstream sync 操作说明。
- [x] 建立 Desktop / Core build flavor、Core system-runtime artifact 与部署/升级/回滚说明；明确不建设 Electron Headless 中间发行产品。

文档职责保持：

```text
docs/atom-roadmap.md      当前未完成事项、优先级、验收标准
docs/atom-development.md  开发环境、构建、维护规则
docs/build-flavors.md     Desktop / Core flavor 与发行边界
docs/core-deployment.md   Core 安装、升级、回滚与 systemd 运维
task_plan.md              当前阶段、下一步与架构护栏
findings.md               当前发现与决策
progress.md               当前交付状态与最近进展
history/                  本地历史阶段 / 会话交接快照（Git 忽略）
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
