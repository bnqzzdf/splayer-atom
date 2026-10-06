# AGENTS.md

## Scope and authority

- Product: Linux x86-64 Node Core with Web Control as the only UI, connected through Core HTTP/WS.
  Scope is one user on a trusted LAN with one active output; extensions require accepted requirements.
- This file defines lasting constraints. [Roadmap](docs/atom-roadmap.md) owns priorities and
  acceptance status; [development guide](docs/atom-development.md) owns workflows and conventions.
- Resolve documentation/code conflicts against accepted requirements: fix nonconforming code or
  stale documentation. Existing code alone does not establish correctness.

## Core and implementation boundaries

- Core owns music-domain state, persistence, credentials, queue, playback policy, source resolution,
  cache/preload, downloads, statistics, plugins, and output assignment.
- Web sends high-level commands and consumes snapshots/events through existing Core contracts.
  It may cache projections and own browser-local display preferences; playable URLs, retry/skip
  policy, and Source Direct staging remain Core-owned.
- ALSA and strict Diretta use the shared `audio-engine`; UPnP is a Core-owned single-renderer path
  under the same playback authority.
- Solve actual problems or accepted requirements with the smallest concrete change. Reuse existing
  models, services, and contracts; never duplicate business authority or canonical state.
- Optimize for minimal changes, simple implementations, stability, and performance. Do not add
  safeguards, fallback paths, or tests solely for speculative edge cases.
- When low-value features cause conflicts or complexity, propose removing them before adding
  defensive machinery. Remove features only when authorized; keep implementation and verification
  proportional to the actual task.
- Split real responsibilities, but add abstractions only for demonstrated needs or repeated
  duplication. Protocol, storage, and UI representations may differ without becoming new authorities.

## Diretta and realtime audio

- Diretta is strict Source Direct: preserve PCM samples, effective bit depth, rate, and channels;
  preserve the native DSD logical one-bit sequence, rate, and channels.
- Lossless decode/container adaptation is allowed. Wider transport slots must preserve effective
  integer sample bits; DSF/DFF bit-order adaptation must preserve the logical DSD sequence.
- No resampling, remixing, normalization, ReplayGain, EQ/preamp, non-unity software gain, fade,
  tempo, pitch, re-encoding, PCM fallback, DoP, or DSD-to-PCM.
- Never route strict Diretta through the normal `f32` DSP/resampler path. Reject unsupported Target
  formats explicitly; never silently process or fall back.
- Keep allocation, locks, logging, discovery, negotiation, and avoidable copying out of the SDK
  realtime callback.

## Data and resource ownership

- Cross-process/Core protocol types live in `shared/types/`; import generated native addon types
  from `@splayer/*` rather than duplicating them.
- Frontend time is milliseconds; convert native seconds at the Core boundary.
- Persist lightweight canonical `Track` values; load details/lyrics on demand and release large
  objects after use. Centralize durable data/cache paths per [deployment](docs/core-deployment.md);
  OpenRC targets (GentooPlayer) are covered by [docs/gentooplayer-openrc.md](docs/gentooplayer-openrc.md).
- Host media files are user-owned: Atom must not expose commands or UI that delete music files.
  Cleanup may remove only Atom-owned cache, temporary, staging, or partial-download files.
- Caches need explicit eviction. Use appropriately sized images; pause RAF/canvas/high-frequency
  UI work while Web Control is hidden.
- ListenBrainz is Core-owned and performs no background work when disabled. When enabled,
  SQLite/HTTP/retry work stays in its isolated child process and never blocks playback/audio paths.
- Production Core logs go to stdout/stderr for systemd/journald.

## Engineering conventions

- Preserve unrelated working-tree changes and keep independent changes separable.
- Code comments are Chinese and explain non-obvious intent. Follow repository formatting and
  auto-import/component-registration conventions.

---

# 工程实施纪律（R1～R10）

> 本节同步自跨项目标准 **`harmonyosnews/engineering-standards`**
> （本机路径 `~/engineering-standards`），适用于本仓库的**一切代码变更、构建、
> 部署与调试**；非工程类任务不适用。
> **上文是本仓库的项目专有约定；两者冲突时以项目专有约定为准。**
>
> 本仓库的环境体检件：`envcheck/specs/splayer-atom-core.yml`（位于 engineering-standards 仓库）。
> 通用引擎 `envcheck/envcheck.py`；改完检查单必须先跑 `envcheck/assert_envcheck.py`
> （它会校验全部检查单的只读性质与登记册一致性）。

> 本项目在登记册中的状态见 `ENGINEERING-PROJECTS.md` 的 `splayer-atom-core` 行。

## R1 ★ 首选规则：环境可判定性优先

**在写第一行业务代码之前**，先交付环境可判定性，四件事：

1. **环境前提清单** —— 逐条列出项目依赖的外部实体（服务进程 / 硬件设备 /
   网络 / 权限 / 配置），并写明每个实体的"满足"判据。
2. **环境体检脚本** —— 独立于主程序，逐项检查，**输出一句可执行的结论**
   （不是一堆原始数据）。
3. **基线机制** —— 已知良好状态可 `--record`；之后逐次比对，识别"部分降级"。
4. **开机自检** —— 主程序启动时自动跑一次，结论进日志；**永不阻断启动**。

三条硬性质：

- **双向结论**：既能说"环境不满足（**与代码无关**）"，也能说"环境正常
  （**问题在代码侧**）"。只说其一等于没做——无法排除环境就不能确认代码。
- **只读**：体检绝不允许改变被测系统的状态（不占资源、不建会话、不写入）。
  该性质必须写成断言，并有实测记录。
- **被断言守住**：体检脚本本身纳入构建闸门（R2）。

**判据**：如果你无法回答"这个现象是环境造成的还是代码造成的"，
那么你接下来的所有调试都不可信。

**何时必须触发 R1**：出现"看起来像缺陷但无法复现/时好时坏"的现象时，
**先跑环境体检，再改代码**——不允许先改代码后观测。

### R1.1 ★ 回溯义务：已有项目也必须补建，不得豁免

**"代码已经写好"不是跳过的理由。** 恰恰相反——已有项目积累的环境盲区更多，
而且已经为此付过代价。

- **触发时机**：对一个尚未有体检件的已有项目，**在下一次对它做任何代码变更
  之前**必须先补建体检件。"下次再说"不被接受。
- **复用优先**：补建时使用通用引擎
  `~/engineering-standards/envcheck/envcheck.py` + 该项目的声明式检查单
  （`~/engineering-standards/envcheck/specs/<project>.yml`），**不要每个项目写一份脚本**——
  那会让输出格式、退出码、结论口径立刻分叉（R3）。
- **项目特化**：若通用引擎覆盖不了该项目的特有前提（例如需要 SDK 做只读发现），
  允许写项目专用体检件，但必须沿用同一套结论口径与退出码。

### R1.2 ★ 登记册是唯一事实来源

`~/engineering-standards/ENGINEERING-PROJECTS.md` 逐个登记本机所有工程项目及其体检件状态。
状态只允许三种取值，**不允许留空**：

| 状态 | 含义 |
|---|---|
| `已建` | 有可运行的体检件，且已实测过判定正确 |
| `待建` | 尚无体检件，且尚未做下一次代码变更 |
| `不适用` | **必须写明理由**（例如纯归档目录、第三方检出、无外部依赖） |

**新增项目时先登记**；状态变化时同步更新。登记册腐烂等同于规则失效（M8）。

### R1.3 完成判据

一个项目的体检件算"已建"，必须同时满足：

- [ ] 能跑通，且**四类环境故障**都能被正确判定（外部实体缺失 / 实体存在但不可用 /
      部分降级 / 实体正常）；
- [ ] 结论**双向**可读，退出码 `0/1/2/3` 分级；
- [ ] 全程**只读**，并有实测记录；
- [ ] 已接入**开机自检**（若是长驻服务）；
- [ ] 已登记到 `~/engineering-standards/ENGINEERING-PROJECTS.md`，状态为 `已建`。

---

## R2 构建前断言闸门

顺序固定、不可跳：**断言全绿 → 构建 → 安装**。

- 断言要把"这次改动要成立哪些**结构事实**"显式化；
- 结构断言一律在**剥离注释与字符串**后的代码上做；
- 文案类断言用"只剥注释、保留字符串"的另一条路径；
- 断言脚本必须能在**没有补丁的代码上跑出红**（R6）。

## R3 同一缺陷第 3 次重现 → 转成断言或抽象

不要第三次手修。第 3 次出现说明缺的是抽象或断言。

## R4 同型返回值一律用具名结构

禁止 `a, b = f()` 这种裸元组解包，尤其是返回两个同类型值的函数。
用具名结构（NamedTuple / dataclass / struct），让顺序错误在语法上不可能发生。

## R5 单测必须覆盖调用点，不能只测函数本身

"返回结构 + 调用点消费"的地方，断言必须同时覆盖**调用点**。

## R6 断言脚本先做负对照

新写的断言脚本必须先在**没有补丁的代码上跑出红**。

## R7 只读工具不得有副作用

诊断/体检/探针工具必须：① 注释里写明禁止调用的 API 清单与理由；
② 断言里逐条禁止；③ 有一条实测记录证明副作用不存在。
（探针曾经把被测系统搞坏，制造了它本要观测的故障。）

**"只读"的边界要划清（补建检查单时实测补充，三条）**：

- **本地资源占用判定必须纯读**。例如"端口是否被占用"必须读 `/proc/net/tcp`
  （或 `ss -ltn`），**绝不能用 `bind()` 试探**——那会短暂**占用**被测端口，
  本身就是"占资源"。（envcheck 引擎初版正是这么写的，被审计发现后改为纯读。）
- **与外部建立连接的探测必须显式声明**。TCP connect 会建立一次连接，哪怕
  立即关闭、不发送任何数据。没有纯读替代品时仍允许使用，但检查单必须用
  `lint_allow_probe` + 理由显式声明，**不允许静默发生**；同时，本地能纯读的
  部分不许退化成探测。
- **断言必须覆盖工具自身，而不只是数据**。只 lint 检查单、不 lint 引擎原语，
  就会漏掉"引擎自己 bind 端口"这类问题。

## R8 结论文案必须能被证据支撑

没有基线就不能说"与基线一致"。凡是结论行/汇总行/徽章，都要能指向具体证据；
指不到就改文案或删掉。**不允许把"无法判定"写成"正常"。**

## R9 变更前工作区必须干净

动手前工作区必须干净；上一轮的坏改动**先回退到干净基线**再重做，
不要在坏改动上继续叠补丁。

## R10 环境与代码的边界要写进交付文档

交付物必须有一节写清"哪些现象属于环境、哪些属于代码"，以及环境故障的处置步骤。
运维人员看到的是日志，不是源码。

---

## 交付前自检（工程类任务收尾时逐条过）

- [ ] 环境前提清单已在？（**新项目与已有项目都算**；已有项目见 R1.1 回溯义务）
- [ ] 环境体检脚本可跑、结论双向、只读、进了构建闸门？
- [ ] 断言全绿才构建？（本轮已保持）
- [ ] 新增/修改的逻辑有对应断言，且断言做过负对照？
- [ ] 同类缺陷是否第 3 次出现？若是，已转成断言/抽象？
- [ ] 文档写了"环境 vs 代码"的现象边界与处置？
- [ ] 工作区干净、提交信息说明了"为什么"而非"改了什么"？
