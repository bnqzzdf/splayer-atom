# SPlayer Atom — Local Codex Handoff

> 状态日期：2026-08-30
>
> `docs/atom-roadmap.md` 是产品范围、优先级与验收状态的唯一正式来源。本文件只记录当前 checkout 的真实本地交付状态、下一步执行边界和外部阻塞。

## 0. Git ground truth

本轮从以下真实基线恢复：

```text
branch:     dev
base:       9823f41 refactor: 清除最后一处 Player 请求 IPC
origin/dev: 9823f41
origin:     https://github.com/bnqzzdf/splayer-atom.git
splayer:    fetch-only https://github.com/SPlayer-Dev/SPlayer-Next.git
```

随后依据实际 `git diff` 整理出四个本地代码 checkpoint：

```text
8e08583 refactor: 收口 Core Settings 与 Plugin Control 边界
98b71ef test: 固化 Core 下载与在线续播策略
191eefe build: 建立 SPlayer Atom 独立发布身份
4192f8f build: 固化 Atom Core artifact 与发布溯源
```

本文件与 `AGENTS.md`、Roadmap、planning memory 的收口属于紧随其后的 documentation checkpoint。以上提交没有 push；`origin/dev` 仍停在 `9823f41`。继续工作前仍必须以当前 `git log --oneline --decorate`、`git status --short --branch` 与 `git diff` 为准，不得用本文件猜测 HEAD。

历史 planning memory 中的 `12214ae`、`223c18e`、`fb77991` 是 `9823f41` 之前已经落入 ancestry 的旧 checkpoint，不是本轮 Settings/release 工作树已经提交的证据。

## 1. 当前软件冻结点

- 正式产品身份为 `splayer-atom` / **SPlayer Atom** / `0.1.0`。
- Desktop appId / NSIS GUID 为 `io.github.bnqzzdf.splayer-atom`。
- Repository、bugs、updater 与 publish 全部指向 `bnqzzdf/splayer-atom`。
- 正式 update channel 只保留 stable 与 beta。
- Atom installer 不静态抢占 `orpheus://`；兼容功能默认关闭，仅在用户显式启用后 runtime 注册。
- Core Settings 只经 `/settings/core` 与 dedicated domain API；无消费者的通用 Core `/config` 已删除。
- Desktop/Web Plugin 业务共用唯一 Core registry、Core routes/client 与统一 event envelope；本地脚本 picker 仍是 Desktop Host action。
- Web 正常产品 UI 复用共享 App/router；`HeadlessApp` 只用于 `/debug`。
- 音乐 Download contract 为 Core-only：`DownloadRequest.destination` 固定为 `"core"`。
- Netease `fee=4` 使用独立 `NETEASE_PURCHASE_REQUIRED`，不再误报 VIP entitlement。
- 确定性 real-session harness 覆盖三首在线连续播放、一次 fresh resolve、失败后 advance、fake ALSA → Diretta 切换与 auto-next。
- Core release metadata 与 `/api/info` 统一投影 Atom version/commit/dirty、SPlayer baseline、protocol、runtime、capability 与 schema。
- Core 正式 artifact 名称为：
  - `splayer-atom-core-system-linux-x64.tar.gz`
  - `splayer-atom-core-bundled-linux-x64.tar.gz`
- About 页面显示 Core version、Atom commit、SPlayer baseline、Core Protocol、source state 与 Core Node runtime。

## 2. 本轮真实验证记录

提交拆分期间已通过：

```text
Settings / Plugin / Host-capability focused tests: 34 / 34
Download / online playback focused Node tests:     22 / 22
Release identity tests:                              7 / 7
Release-assets tests:                                3 / 3
Core provenance / artifact focused tests:           39 / 39
Web suite:                                          84 / 84
Node/Web typecheck:                                  PASS
touch audit:                         105 / 22 / 13 / 14
git diff --cached --check:                           PASS
Core system final tar smoke:                         PASS
Core bundled final tar smoke:                        PASS
```

documentation checkpoint 后的 clean-tree gate 已重新通过 Node 280/280、Web 84/84、Node/Web typecheck、ESLint、当前 `origin/dev..HEAD` 全部变更文件的 Prettier、touch audit 105 / 22 / 13 / 14 与 commit-range whitespace check。全仓 `prettier --check .` 另发现 11 个本轮范围外的继承格式问题；它们没有被顺手重写。Desktop production build 与 clean-HEAD artifact smoke 仍应单独记录实际运行结果，不得用旧结果冒充。

本轮 artifact smoke 在提交整理过程中生成，因此其中 `sourceDirty=true` 是对当时工作树的正确记录，不是正式 release candidate。正式 clean release CI 必须产生 `sourceDirty=false`。

## 3. 当前外部阻塞

以下项目不能用 fixture、静态测试或编译结果标记完成。

### 真实账号

- Netease Favorites / Daily / Cloud live acceptance。
- Qobuz real-account search → queue → playback、普通输出、Diretta 与 Core-owned auto-next。
- TIDAL entitlement、JSON/BTS、DASH、普通输出、Diretta 与 Core-owned auto-next。
- TIDAL first-party Authorization Code / PKCE 需要 Atom-owned TIDAL Developer application 与 redirect 配置。

### 真实硬件

- ALSA hardware playback。
- PCM bit-perfect / sample-rate 前面板或等价外部观测。
- Native DSD。
- Diretta Target 实机播放。
- long-play、auto-next 与 output switch hardware regression。
- Linux x86-64 hardware support promotion；ARM64 还需要真实 ARM64 主机全链路验收。

### CI / infrastructure

- 注册受控 `self-hosted, linux, x64, diretta-sdk-149` runner。
- 在 checkout 外预置只读 Diretta SDK 149。
- 首次执行远端 `Core Diretta Release Gate --require-diretta`。

## 4. 无账号/硬件时可做的下一项工作

主线软件功能已经接近冻结。不要继续泛化 IPC cleanup 或发明新架构；只做能缩短真实验收路径的基础设施。

### Hardware release diagnostic

可以新增一个 Atom-owned、只做观测与编排的脚本，例如 `scripts/atom/check-hardware-release.ts`：

- 读取 `/api/info` 的 Atom/Core release identity 与 capability。
- 列出 Core 可见 outputs，并明确 ALSA 与 Diretta。
- 输出当前 session、queue、track 与 selected output。
- 仅按显式参数执行 PCM、Native DSD、multi-track auto-next、output switch 或 long-play checkpoint。
- 失败时采集结构化诊断，不自行修改 settings/database/session 绕过失败。
- 不声称能自动判断 DAC 前面板是否显示原始采样率或 DSD；该项必须人工确认。

优先复用现有 Core Control Protocol，不新增 debug-only 高权限 API。

### 验收记录模板

可以增加简洁的 hardware/live-provider checklist，至少记录：

- artifact SHA256、Atom version/commit/sourceDirty、SPlayer baseline。
- distro、kernel、Node variant、DAC/ALSA device、Diretta Target 与 Host SDK release。
- source format、rate、channels、DSD rate，以及 expected/observed DAC indication。
- auto-next、output switch、continuous-play duration 与 PASS/FAIL/BLOCKED reason。
- Netease Favorites/Daily/Cloud、Qobuz、TIDAL 的真实账号矩阵。

任何 cookie、token、Authorization、最终 playable URL 都不得写入 fixture、日志、handoff 或 Git。

### 只读诊断包

若实现诊断 bundle，只收集 `/api/info`、runtime metadata、sanitized output list、无敏感 URL 的 session metadata 和用户指定日志。必须主动脱敏 provider credential、Authorization、cookie、playable URL 与不必要的私人路径。

## 5. 明确不要做

- 不实现 Control-local music download。
- 不重新引入 generic Core `/config`。
- 不新增第二套 Web player/queue/provider/settings authority。
- 不为了“统一”机械迁移剩余 Desktop Host IPC。
- 不把 `orpheus://` 改成品牌 scheme；它是显式 opt-in upstream compatibility。
- 不主动扩展 QQ Music / Kugou 产品能力。
- 不在没有真实账号/硬件证据时勾选 live/hardware acceptance。
- 不提前建设 Desktop Output Agent、Control file upload、Zones、TLS/auth，除非 Roadmap 假设发生变化。
- 不 push 到 `splayer` remote。
- 不 push `origin`，除非用户明确授权。

## 6. 下一交付条件

在需要用户介入前，理想状态是：

1. `git status` 干净，且 local commits 可独立审阅。
2. 全仓 Node/Web/typecheck/lint/format/diff checks 继续全绿。
3. touch budgets 保持 105 / 22 / 13 / 14。
4. system 与 bundled Core final-artifact smoke 从 clean tree 通过。
5. Desktop release identity 回归继续通过。
6. hardware/live-provider checklist 与只读诊断路径就绪，但 Roadmap 的 live/hardware 项保持未完成。
7. `docs/atom-roadmap.md` 与 planning memory 和真实 Git 状态一致。

达到这些条件后，应向用户明确请求下一项真实账号、受控 runner 或硬件输入，而不是继续增加无关软件工作。
