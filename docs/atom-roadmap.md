# SPlayer Atom Roadmap

> 状态日期：2026-09-02
>
> 本文只记录当前产品范围、未完成工作和验收门槛。耐久工程规则见
> `AGENTS.md`；构建、部署、上游同步和类型细节由对应专题文档负责。已完成的迁移过程、
> 临时测试计数、历史提交和本地构建快照不再保留在 roadmap 中。

## 1. 产品范围与长期模型

SPlayer Atom 是 SPlayer Next 的持续下游产品。SPlayer 提供播放器、媒体、UI 和通用基础；
Atom 只维护已经确认的差异能力：

- 普通 Node Core 与 Headless Web；
- Web / Desktop 统一 Control；
- Qobuz、TIDAL；
- ListenBrainz Core Scrobble；
- Diretta strict Source Direct。

长期模型为 **Core / Control / Output**：

- Node Core 是 database、settings、library、provider session、canonical queue、playback policy、
  source resolution、cache、preload/recovery、play statistics、output assignment 和 Diretta input
  materialization 的唯一权威。
- Web 与 Desktop 只发送高层命令并消费 Core snapshot/event。Desktop 的窗口、托盘、热键、
  updater、协议、本机文件和歌词窗口属于 Host Capability。
- Core Local Output 通过唯一 `audio-engine` 实现 ALSA 或 Diretta；`audio-engine-core` 是音频实现，
  `audio-engine` 只是 NAPI shim。
- Qobuz/TIDAL 的协议实现只存在于 Rust `native/streaming-api`；Node 只持有 auth/session/policy
  adapter。Netease 保持现有 TypeScript 实现。
- QQ Music/Kugou 只继承官方 SPlayer 的冻结兼容面，不形成 Atom provider 产品路线。
- 不恢复 Electron Headless、Pure Rust Headless、第二 Core、Rust QQ/Kugou、provider sidecar、
  第二音频引擎、第二 Diretta bridge 或协议 fallback。

当前产品仍定位为单用户、用户自有主机、可信局域网。公网、多用户和零信任部署不属于当前
发布边界。

## 2. 状态定义

- `[ ]`：尚未完成，或缺少正式验收证据。
- `[~]`：软件能力已存在，但仍缺真实账号、真实硬件、远端 CI 或正式发布验收。
- `[x]`：当前阶段已经实现并通过相应软件门禁。

源码构建、fixture 或 mock 通过不能把真实账号、真实 ALSA/Diretta、Native DSD 或长时间运行
项目标记为完成。

# P0 — 代码来源与长期可维护性

## 3. 唯一正式上游与候选能力源

Atom 采用“一个正式基线、一个候选能力源”的更新模型：

```text
official SPlayer dev
        ↓ fetch-only splayer
vendor/splayer
        ↓ dedicated integration merge
Atom dev

songlian ffs/dev
        ↓ review / cherry-pick -x / minimal port
Atom dev
```

### 官方 SPlayer 通道

- [x] `origin` 只代表 Atom 自有仓库和发布目标。
- [x] `splayer` 为 fetch-only 官方 remote；`vendor/splayer` 只能 fast-forward 到官方 SPlayer
      commit，并且不能包含 Atom delta。
- [x] `scripts/atom/upstream-sync.mjs` 支持 topology 配置、vendor advance、candidate report、
      accepted baseline 记录和 ancestry 校验。
- [x] upstream touch audit 使用已验收的固定 baseline，不随普通 fetch 漂移。
- [x] 官方更新在独立 `sync/splayer-*` branch/worktree 中 merge、解决冲突和验证；不通过 rebase
      改写已经发布的 Atom 历史。
- [ ] 当前 `dev` 按 `docs/upstream-sync.md` 完成下一轮官方 integration，让标准 checkout 的
      `upstream-sync.mjs status` 通过，并在验收后记录新的 accepted baseline。

### songlian `ffs/dev` 通道

- [x] `ffs/dev` 被定义为候选能力源，而不是第二 foundation upstream、vendor 或 accepted
      baseline。
- [x] 禁止把 `ffs/dev` 整体 merge/rebase 到 Atom，也禁止从它间接获取本应来自官方的 UI、
      player、queue、library 或 lifecycle 更新。
- [x] 同时存在官方和 `ffs/dev` 更新时，先完成并稳定官方 integration，再审查 `ffs/dev`。
- [x] 审查时固定候选 SHA，逐提交、逐路径判断；完整提交只有在架构一致且独立 checkout 可用时
      才允许 `git cherry-pick -x`。
- [x] 混合提交只移植符合当前 ownership 的最终最小修改；不保留源分支的中间态、目录布局、
      wrapper、fallback 或退役产品架构。
- [x] 每个移植使用独立 `port/ffs-*` 分支和原子提交，并按 provider/Core/audio 影响范围验证；
      Diretta 行为变化仍需要 strict Direct 审计和真实硬件 gate。

适合审查的候选主要包括 Rust Qobuz/TIDAL 协议修复、满足 strict Source Direct 的 Diretta
lifecycle/SDK 修复，以及可独立证明的通用算法或 fixture。任何 Pure Rust Headless/Core、
Rust QQ/Kugou、TypeScript streaming protocol fallback、`f32` Diretta、旧 cfg/build path 或第二
bridge 必须拒绝，而不是先合入再清理。

### 上游贡献

- [x] 可独立贡献给官方 SPlayer 的通用修复从纯净 `vendor/splayer` 创建 `contrib/*` 分支。
- [x] 不从 Atom `dev` 直接向官方提交包含 Atom branding、Core、Qobuz/TIDAL 或 Diretta 的 PR。
- [x] 官方吸收等价实现后，Atom 在下一轮 integration 中删除对应下游重复 patch。

### 更新验收门槛

一次代码来源更新只有同时满足下列条件才能进入 Atom `dev`：

- 来源 commit 固定且可追溯；
- 没有引入第二 authority、第二实现、fallback 或已退役产品；
- 每个提交单独 checkout 时仍是完整可构建状态；
- touch audit 没有被 wrapper 或搬移伪装；
- 自动门禁按影响范围通过；player、queue、native、output、provider session 或 lifecycle 改动
  完成对应 live/hardware 验收；
- 工作分支与官方 integration、`ffs/dev` 移植保持来源可区分，不混成无法审计的大提交。

# P1 — Core 播放与真实硬件闭环

## 4. 软件架构基线

- [x] Node Core 已成为 queue、provider session、playback policy、source recovery、cache、preload、
      output selection 和 Direct staging 的唯一业务权威。
- [x] Desktop/Web 共用 Core Control Protocol；renderer 不再解析最终播放 URL，也不拥有
      auto-next、retry/skip 或 Direct materialization。
- [x] Core Linux x86-64 artifact 只打包正式 native addons：`audio-engine.node` 和
      `streaming-api.node`。
- [x] `audio-engine-core` 持有 PCM/DSD decode、strict Direct 和 Diretta runtime；
      `diretta-sys` 只保留唯一 SDK FFI。
- [x] Qobuz/TIDAL TypeScript HTTP/signature/auth/manifest/DASH protocol fallback、Pure Rust
      Headless、Rust QQ/Kugou 和旧 Diretta output/backend 已删除。
- [x] Core source recovery 只允许同一 canonical Track 有界 fresh resolve；失败后的推进由 Core
      policy 决定，Control 不参与。

## 5. 真实音频主机验收

以下为正式发布硬件 gate 的当前状态：

- [ ] 真实 ALSA `hw:*` PCM 播放，覆盖常用 sample rate/channel/bit depth。
- [x] Native DSD 播放及 DSF/DFF logical one-bit sequence 已完成实机 bit-perfect 验证。
- [x] 以 root Host 连接真实 Diretta Target 的 exact PCM Source Direct 已完成实机验证；当前已验证
      播放素材的源 PCM 数据/格式与 `/proc/asound/card0/stream0` 暴露的实际 USB Audio stream
      状态及 DAC 显示一致，未观察到 sample rate、channel 或 PCM bit-depth/transport format 偏离。
- [x] 真实 Diretta Target 上的 Native DSD Source Direct 已完成实机 bit-perfect 验证，确认
      strict Direct 的 DSF/DFF logical one-bit sequence 在实际播放链路中保持不变。
- [x] Diretta Source Direct 实机格式覆盖已验证到 PCM 768 kHz 与 Native DSD512；其下实际支持的
      PCM sample-rate 档位与 Native DSD rate 档位均已完成播放验证。
- [x] Diretta 混合格式队列已完成过夜循环长时间播放，覆盖不同 PCM rate 与 Native DSD 的连续
      format transition，未观察到播放中断或格式切换异常。
- [ ] 在线队列连续自然播放至少三首；关闭全部 Web/Desktop Control 后仍继续推进。
- [ ] ALSA ↔ Diretta output switch、source recovery、preload/gapless boundary 和连续播放回归。
- [ ] 停止/重连、Core/systemd restart、SIGTERM 与进程退出，确认没有连接竞态、资源泄漏或错误重试。

Diretta 验收必须证明 sample rate、channel count、有效 PCM sample value/bit depth，以及 Native
DSD logical sequence/rate/channel count 均未改变。当前 exact PCM 与 Native DSD Source Direct
real-target gate 均已有实机 bit-perfect 证据；格式覆盖已实测到 PCM 768 kHz 与 Native DSD512，
混合格式过夜循环长播也已完成。正式 release candidate 仍必须使用最终 clean artifact 重新执行
对应硬件 smoke，以及尚未完成的 restart/exit/output-switch 等独立 lifecycle gate。编译、fixture
和无 Target smoke 不能替代这些发布证据。

# P2 — 在线平台与真实账号验收

## 6. Netease

- [x] 现有 TypeScript provider、Core session、VIP/购买限制映射、source recovery 和统一 Control
      transport 已接入。
- [x] 软件 acceptance 已覆盖无 Control 的 queue progression 和同曲有界 fresh resolve。
- [ ] 使用真实账号完成收藏、日推、云盘分页/删除/播放和状态变更验收。
- [ ] 使用真实在线队列完成普通 ALSA 与 Diretta 连续播放验收。

## 7. Qobuz

- [x] Rust `native/streaming-api` 是唯一协议实现；Node Core 只管理 credential/session 和调用
      adapter。
- [x] 账户 UI、session projection、catalog search、canonical Track、播放地址解析和 Direct input
      materialization 的软件链已接入。
- [ ] 使用真实账号完成 login/session、search → queue → playback 和退出验收。
- [ ] 完成普通 ALSA、Diretta 和无 Control 自动下一首验收。

不持久化自动发现的 Qobuz app secret，不读取 qobuz-dl 配置，不建立第二 URL/cache 实现。

## 8. TIDAL

- [x] Rust `native/streaming-api` 是唯一 auth/request/manifest/DASH 实现；Node Core 只持有用户
      token、refresh token、session 和 policy。
- [x] 账户 UI、session projection、search、canonical Track、JSON/BTS、DASH materialization 和
      fragmented MP4/FLAC 软件链已接入。
- [x] 正式允许 protocol engine 使用 atom-base 已验证的 client credential/redirect；具体凭据只
      存在于该唯一 Rust 协议实现，Node/Control 不复制授权协议。
- [ ] 使用真实账号完成授权、refresh、entitlement 和退出验收。
- [ ] 分别完成 JSON/BTS 与 DASH 的真实播放。
- [ ] 完成普通 ALSA、Diretta 和无 Control 自动下一首验收。

## 9. ListenBrainz Scrobble

- [x] ListenBrainz 由 Node Core 持有唯一 listen-session authority；Desktop/Web 只通过现有 Core
      Control seam 配置并消费 token-free status，不允许 renderer 直连 ListenBrainz，也不建立
      Electron-only 或第二 playback tracker。
- [x] 首版实现可靠 Scrobble 与独立 Now Playing；不做 Love/Recording Feedback Sync，也不做
      MusicBrainz MBID/MSID identity matching。永久 listen 阈值为 `min(duration / 2, 240s)`，按实际
      playing wall-clock 累计，pause/buffering/forward-seek 跳过区间不计入；Repeat One/replay 和
      gapless boundary 建立新 listen，同曲 source recovery/reload/output switch 保留原 listen。
- [x] disabled 时 ListenBrainz runtime 完全不存在：不创建 child process，不打开 outbox SQLite，
      不建立 HTTP client、retry/restart timer 或高频 position listener；从 enabled 切换为 disabled
      会终止 child 并释放运行时资源。正式 bundled Core 实测首次 disabled 为 0 child 且无 outbox
      文件，enabled 恰好 1 个 child，再次 disabled 回到 0 child；既有 durable DB 文件可保留但不再打开。
- [x] enabled 时所有 SQLite、HTTP、JSON payload、retry/backoff 与 Now Playing 网络工作只在
      ListenBrainz 独立 child process 中执行。Core playback/audio path 只维护轻量 listen session、
      wall-clock timer 与非阻塞 IPC，不等待 child，也不执行 ListenBrainz 同步 I/O、网络或数据库。
- [~] ListenBrainz child crash 已通过进程终止/关闭竞态验证，不会在 disabled 后自行复活；网络超时、
  401、408、429、5xx 和 durable backlog 已实现隔离与错误分类，但仍需真实 token/故障注入和
  ALSA/Diretta 连续播放验证，才能完成“任何 ListenBrainz 故障都不影响音频链”的 live gate。
- [x] 达到阈值的永久 listen 使用稳定 capture id；父 Core 在内存保留未确认 snapshot，child 以幂等
      SQLite insert 落入 durable outbox 后才回 ACK，再异步提交。retryable failure backoff，auth error
      保留待恢复，permanent error dead-letter 且不堵后续 listen；child 异常重启会重送未 ACK capture。
- [x] 复用现有 playback lifecycle、`createPlayProgress()`、Core settings/control、runtime secret codec、
      `better-sqlite3` 与既有数据目录/child-process seam；未新增 provider registry、sink framework、
      第二 event bus 或其他为未来 Last.fm 迁移预建的抽象层。
- [~] 自动化已覆盖 session authority、Direct boundary、pause wall-clock、same-track reload、disabled
  零进程、child-owned I/O、token-free Control 与构建/进程生命周期；仍需真实 ListenBrainz token
  完成永久 listen/Now Playing、断网恢复、Core restart pending drain、invalid token、429，以及真实
  ALSA/Diretta/CUE/在线音源的启用/关闭对比，作为最终 HiFi live acceptance。

## 10. QQ Music / Kugou

- [x] 产品入口冻结，只保留官方 SPlayer 现有 TypeScript compatibility。
- [x] Atom 不开发登录、权益、resolver、cache、Diretta 专项逻辑或 Rust provider。
- [ ] 官方未来修改相关能力时，只做 Atom Core/Control 兼容回归；通用问题按 `contrib/*`
      流程反馈官方。

# P3 — Release、部署与 Control 产品验收

## 11. Core artifact 与发布门禁

- [x] Core 支持 Node `>=24.18.0 <25`，release reference runtime 为 `24.18.0`。
- [x] system-runtime/bundled-runtime 共用同一 Core JS/native contract；最终 `tar.gz` gate 覆盖
      staging、native addon load、plugin-host IPC、Core/Web endpoints、startup 和 termination。
- [x] artifact metadata 记录 Atom identity/commit/source state、SPlayer accepted baseline、Node、
      protocol/schema、capability 和 Diretta SDK provenance。
- [x] Core durable `data/`、独立 cache、stdout/stderr logging、schema migration、backup/rollback 和
      systemd 部署模型已经建立。
- [x] Diretta-branded artifact 使用 `--require-diretta`；SDK 缺失或 release provenance 不匹配时
      必须在产生同名 artifact 前失败。roadmap 不硬编码 SDK release。
- [~] 自动化 SDK-enabled release gate 已存在，但仍需注册受控 self-hosted Linux x64 runner，
  执行首次远端 gate。
- [ ] 在候选 release commit 上完成 clean hosted Core artifact gate 和真实硬件 checklist。
- [ ] 发布首个经过上述门禁的正式 SPlayer Atom Core release，并验证安装、升级和回滚流程。

Linux x86-64 是首个正式 Core 平台。其他架构只有 compile capability，不在没有真实机器完整
验收时声明支持，也不作为当前主动扩展任务。

## 12. Web / Desktop Control

- [x] Web 与 Desktop 共用 Vue renderer、Core clients、authoritative session projection、Provider
      session、Library、Playlist、Download、Stats、Cache、Settings、Plugin 和统一 Action Model。
- [x] Core Domain UI 按 Core capability 展示；Desktop window/tray/hotkey/updater/native-file 等按
      Host Capability 展示，不通过 no-op facade 伪造 Web 能力。
- [x] Core path 与 Control-local path 已区分；Library、Download 和 cache 目录最终由 Core 验证。
- [x] 多个 Control 不创建第二 queue/settings/provider/playback authority。
- [ ] 在真实 Core 主机上完成 Desktop + 多 Web Control 同时连接、断开、重连和长时间运行验收。
- [ ] 低优先：如后续确有产品需求，通过正式 Core output contract 增加 Diretta Target 只读
      capabilities projection；必须复用现有 output identity/discovery，不重新引入独立
      scan/status/select transport，也不阻塞当前 release。

当前 renderer lyric selection 是已知 presentation seam，不作为惯性重构任务。只有出现可复用、
runtime-neutral 的小型 canonical lyric resolver，且不需要搬运 Vue/settings/presentation parser 时，
才重新评估 ownership 下沉。

# P4 — 可信 LAN 边界以外的安全增强

以下项目不阻塞当前单用户可信局域网发行；如果产品转向公网、不可信网络或多用户，必须重新
提升到 P0/P1：

- [ ] 首次配对或 access token。
- [ ] HTTP/WebSocket authentication。
- [ ] CSRF/Origin policy。
- [ ] TLS/reverse proxy 正式部署方案。

Core 不暴露 Direct materialize/stage/commit 低层 API，Control 只发送 output/playback 高层命令；
该约束与是否增加网络认证无关。

## 13. 当前执行顺序

1. 完成 ListenBrainz 真实 token、断网/401/429/Core restart 与 ALSA/Diretta/CUE/在线音源 live
   acceptance；软件实现、disabled 零进程和 enabled child-process I/O 隔离已完成。
2. 当前 `dev` 完成下一轮官方 SPlayer integration，并记录新的 accepted baseline。
3. 建立受控 Diretta release runner，完成远端 SDK-enabled artifact gate。
4. 在真实音频主机完成剩余 ALSA、output switch、restart/exit lifecycle 验收；Diretta exact PCM
   与 Native DSD Source Direct 已完成 real-target bit-perfect、PCM 768 kHz / DSD512 覆盖及混合
   格式过夜循环实机验证。
5. 依次完成 Netease、Qobuz、TIDAL 真实账号与普通/Diretta 播放验收。
6. 在同一 release candidate 上完成 clean hosted artifact、部署/升级/回滚和多 Control 验收。
7. 发布首个正式 Core release。

`ffs/dev` 没有固定“整合阶段”；只有出现具体候选提交时，才在上述稳定基线之上创建独立
`port/ffs-*` 工作并按本 roadmap 的架构和验收门槛判断。

## 14. 已完成且必须持续回归的基线

- Node Core 与统一 Core Control Protocol；
- 本地 library/scanner、authoritative queue、playback policy、cache/preload/recovery；
- Web/Desktop 统一 Control 与 capability-driven UI；
- ALSA/Diretta 软件输出链、strict PCM/DSD Direct 测试；
- Diretta exact PCM 与 Native DSD Source Direct real-target bit-perfect 实机验证；
- Diretta PCM 最高 768 kHz、Native DSD 最高 DSD512 及其下支持 rate 的实机格式覆盖；
- Diretta PCM/Native DSD 混合格式过夜循环长时间播放；
- Netease、Qobuz、TIDAL Core provider 软件链；
- ListenBrainz Core Scrobble/Now Playing、child-owned durable outbox 与 disabled 零 runtime；
- 独立 Atom identity、Core protocol、portable artifact、systemd、migration/backup/rollback；
- 官方 SPlayer vendor/accepted-baseline/touch-audit 机制；
- 单一 `audio-engine.node` + `streaming-api.node` Core native runtime。

上述“已完成”表示软件基线存在，不替代第 5、6、7、8、10、11 节明确保留的 live/hardware/
release 验收。

## 15. 文档职责

```text
AGENTS.md                          耐久架构、实现、来源与 Git 规则
docs/atom-roadmap.md               当前范围、未完成工作、优先级与验收门槛
docs/upstream-sync.md              官方 SPlayer 同步、baseline 与 contribution 操作
docs/atom-development.md           开发环境与常用门禁
docs/build-flavors.md              Desktop/Core flavor 与 Diretta SDK release 规则
docs/core-deployment.md            安装、数据、升级、回滚与 systemd
docs/hardware-release-checklist.md 真实 ALSA/Diretta/DAC 验收
docs/live-provider-acceptance.md   Netease/Qobuz/TIDAL 真实账号验收
task_plan.md / findings.md / progress.md
                                   当前工作记录；不作为长期产品事实来源
```
