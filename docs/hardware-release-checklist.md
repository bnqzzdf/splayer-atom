# SPlayer Atom 硬件发布验收清单

> 最后更新：2026-10-03

本文记录目标音频主机的手工验收步骤。源码构建、fixture 与 fake ALSA/Diretta 不能替代
实际输出设备的功能验证；DAC 端 bitstream 证据仅在作端到端精确性声明时要求。

> **范围说明（哪些是历史记录、哪些是待执行清单）**
>
> - **历史记录**：「当前已取得的开发期实机证据」与「2026-09-22 本机自动化实测补充」两节记录的是
>   已经完成、结论已固定的开发期实机结果，不需要重做。
> - **待执行清单**：从下面「## 1. 前置条件」开始，是需要对**准备发布的最终 clean artifact**
>   逐项执行并留下记录的清单。
>
> 历史记录不能替代待执行清单：已验证的是实现原理，发布包仍需用最终 artifact 重跑一次
> release-candidate hardware smoke。

## 当前已取得的开发期实机证据

以下能力已经在真实 Diretta Host / Target / DAC 链路完成，不再作为“未知能力”保留：

- exact PCM Source Direct 已完成 bit-perfect 实机验证，并覆盖到 PCM 768 kHz；其下实际支持的
  PCM sample-rate 档位均已完成播放验证。
- Native DSD Source Direct 已完成 logical one-bit sequence 的 bit-perfect 实机验证，并覆盖到
  DSD512；其下实际支持的 Native DSD rate 档位均已完成播放验证。
- PCM 与 Native DSD 混合格式队列已完成过夜循环长时间播放，连续 format transition 未观察到
  播放中断或格式切换异常。

ALSA HW 双模式实现另有开发期实机记录，用户于 2026-09-22 确认：

- 已实际试听两天，覆盖 Direct/Processed 及各自支持的 PCM/Native DSD。
- 暂停、拖动进度、切歌和输出切换均已测试，拖动与播放正常。
- 通过 `/proc/asound/.../stream0` 对比音源与声卡输出参数，确认采样率、比特率一致。

这完成了上述范围的开发期试听、参数核对与生命周期验收；参数一致不等于有效 PCM 样本或
DSD 逻辑位序列已逐位比较。后续独立 USB 驱动提交层比对已记录在
[ALSA 验收记录](./alsa-acceptance-2026-09-22.md)；最终发布包仍需单独验收。该层证据
支撑软件输出保证，不代表 DAC 端数字输出已逐位验证。

### 2026-09-22 本机自动化实测补充

通过运行中 Core 的 HTTP 播放接口实测，读取 `/proc/asound/card2/stream0`、
`pcm0p/sub0/hw_params` 与 `pcm0p/sub0/status` 交叉核对，未绕过 Atom 使用外部播放器。
Core 为已安装的 1.1.0，提交 `cecee166b5c3014d0221a2573965314dfda79d98`，
`sourceDirty=false`，与本次审计源码一致；设备为 `alsa:hw:CARD=FC4,DEV=0`（HiBy FC4）。

| 路径              | 音源                                                                    | 实际 ALSA 输出                                     | 结果                                                  |
| ----------------- | ----------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| Direct PCM        | Brahms / Haydn Variations，FLAC，44.1 kHz、16-bit、双声道；ffprobe 核对 | `S16_LE`，44100 Hz，2 channels，`RUNNING`          | 播放进度推进、暂停位置保持、恢复、seek 到 60 秒均通过 |
| Direct Native DSD | Accardo / Beethoven Op.40，DSF，DSD64、双声道；读取 DSF 头核对          | `DSD_U32_BE`，88200 frame/s，2 channels，`RUNNING` | 播放进度推进、暂停位置保持、恢复、seek 到 60 秒均通过 |
| Processed PCM     | 同一 FLAC                                                               | `S32_LE`，44100 Hz，2 channels，`RUNNING`          | 正常播放和进度推进通过；seek 失败，见下文             |

DSD 的 88200 frame/s × 每声道每帧 32 bit = 2822400 bit/s，即原生 DSD64；
USB altset 4 声明 `DOP=0`。不能将 DSD transport frame rate 误认为 PCM 重采样。
PCM seek 到曲尾后自动切入 DSD，以及从 DSD 手动切回 PCM，均成功重新协商并播放。

**发现的问题：Processed PCM seek。** 首轮在切换到 Processed 后 seek 到 30 秒返回
HTTP 400。随后从停止状态重新加载同一 FLAC 为 Processed，seek 到 30 秒仍失败；
重新播放后 seek 到 60 秒再次失败。响应均为
`[Other] processed playback 缺少已协商 ALSA 输出`，播放器转为 paused、位置归零、
output path 清空。同期 Core 日志出现 `native outputFailed, playback paused for explicit recovery`。
该复现覆盖了用户试听记录中尚未暴露的失败路径。`c3e135ab` 修复后，已在包含修复的
`3e420f78` 包上完成 FC4 复验；见 [2026-09-23 记录](./alsa-acceptance-2026-09-23.md)。
本段失败仍是旧包 `cecee166` 的历史结果，不代表后续发布候选的验收。

两轮测试结束均恢复原队列、Direct 模式及原 FC4 输出，保持停止，设备 PCM 状态为 `closed`。
原始快照、检查结果及复现响应保存在测试主机 `/tmp/atom-alsa-live-20260922/`；
此处保留持久化结论，临时文件不作为唯一验收记录。上述首轮测试没有进行数字输出逐位采集，
也没有执行服务重启/SIGTERM、升级回滚或全部发布检查。

同日后续验证已完成 USB 提交数据逐字节比较、Diretta 往返切换、播放中重启/SIGTERM、
FC4 断开重连及 clean artifact smoke，并发现重启后直接 Play 不加载队列的问题。
该软件问题同样已在 `c3e135ab` 修复，并在 `3e420f78` 包上完成 FC4 复验。
完整范围、结果、包/音源 hash 和证据边界见
[2026-09-22 ALSA 与发布包实测](./alsa-acceptance-2026-09-22.md)。

这些结果属于当前开发期硬件基线。正式发布时无需重新证明已验证的实现原理，但仍必须使用准备发布的
**最终 clean artifact** 做一次 release-candidate hardware smoke，以证明发布包、native feature、
Diretta SDK 与已验证源码路径一致。

## 1. 前置条件

- 使用从干净 checkout 生成并已通过 final-artifact smoke 的 Linux x86-64 Core `tar.gz`。
- 正式构建使用 reference Node `24.18.0`；system-runtime 运行最低要求为 Node `22.19.0`，bundled-runtime 必须确认实际进程使用包内 Node。
- Diretta-branded artifact 必须记录 `diretta=true`、`direttaSdkRelease=148`，并由受控 SDK 148 gate 生成。
- ALSA 验收使用明确的真实 `alsa:hw:*` device，不以 `default`、PipeWire 或 PulseAudio 代替。
- Linux Diretta Host Core 以 root 运行；普通用户发现到 Target 不代表具备连接权限。
- 在 Web Control 中预先建立验收队列。诊断脚本不会插入、改写或清空队列。

建议队列至少包含：

- 两种以上源采样率的 lossless PCM；当前 Diretta 开发期实机覆盖上限为 768 kHz，release smoke
  至少复验一个常用 rate 与最高承诺 rate。
- Native DSD；当前 Diretta 开发期实机覆盖上限为 DSD512，release smoke 至少复验一个常用
  DSD rate 与最高承诺 rate。
- 三首连续曲目，用于 Core-owned auto-next 与 long-play。
- 一个在线 HTTP lossless Track，用于 Diretta exact-byte materialization。

## 2. 默认只读诊断

Core 默认地址为 `http://127.0.0.1:14558`：

```bash
ARTIFACT=/path/to/the-built-system-linux-x64.tar.gz
pnpm check:hardware-release -- \
  --artifact "$ARTIFACT"
```

使用由目标 Git 提交构建的 artifact 执行清单，并记录、核对 artifact 的 `runtime.json` 中的
`atomCommit`，以此确认其源码身份。

远端可信 LAN Core 使用显式 origin：

```bash
pnpm check:hardware-release -- --base-url http://192.168.1.20:14558
```

默认调用只读取 `/api/info`、`/api/status`、`/api/session` 与 `/api/output/devices`。输出包含 artifact SHA256、Core identity/capability、分类后的 ALSA/Diretta outputs、播放器状态和脱敏 session metadata；不会输出本地路径、封面 URL 或最终 playable URL。

`scripts/atom/check-hardware-release.ts` 以 JSON 打印报告，报告顶层含 `schemaVersion` 与 `readOnly`：
`readOnly` 为 `true` 表示本次只做只读诊断，没有执行任何 `--select-output` / `--play-*` 动作
（`scripts/atom/check-hardware-release.ts:369-371`）。当 `errors` 非空或任一 action 为 `FAIL` 时，
脚本把退出码设为 1（`scripts/atom/check-hardware-release.ts:418-419`），因此可以直接当门禁用：
默认只读运行退出码非 0 说明诊断本身发现了问题。

`/api/output/devices` 的 Diretta discovery 失败只记录该 endpoint 的错误。不要把用户态 discovery 成功视为连接权限证明，也不要从 discovery/连接超时推断 Target 已损坏、被占用或应被重置。

## 3. 显式播放与输出动作

先运行默认只读诊断，从报告中复制实际 queue index 和 output id。以下参数会改变当前输出或播放状态，必须由验收者显式执行。

### PCM / ALSA

```bash
pnpm check:hardware-release -- \
  --select-output 'alsa:hw:CARD=USB,DEV=0' \
  --play-pcm-index 0
```

脚本会在发送播放命令前确认队列元数据属于 PCM。验收者必须人工记录 DAC 显示的 sample rate、bit depth 与 channels；脚本不能从 Control Protocol 证明最终硬件 bitstream。

### Native DSD / Diretta

```bash
pnpm check:hardware-release -- \
  --select-output 'diretta:TARGET_ID' \
  --play-dsd-index 1
```

脚本会在发送播放命令前确认队列元数据属于 Native DSD。验收必须人工确认 Target/DAC 显示原生 DSD rate 和 channels，且没有 PCM fallback、DoP、重采样、音量处理、DSP 或 DSD-to-PCM。

如果 Target 不接受完全相同的格式，预期结果是明确失败。不得通过改写 settings、queue、database、软件音量或输出格式绕过 Source Direct 失败。

### Auto-next / long-play

```bash
pnpm check:hardware-release -- \
  --play-pcm-index 0 \
  --observe-seconds 1800 \
  --expect-advances 2
```

观察只轮询 authoritative `/api/session`；不触发 next。`observedAdvances` 只证明 Core session 的 Track 边界变化，真实持续出声、无爆音/截断和 DAC 指示仍需人工确认。

### Output switch

分别对 ALSA 与 Diretta output 执行显式 `--select-output`，每次记录：

- 切换前后 selected output。
- 当前 Track 是否由 Core reload/materialize 后继续播放。
- 切换后 sample rate / DSD 指示是否仍与源一致。
- 后续 auto-next 是否仍由 Core 完成。
- 失败是否保持明确且没有静默切回其他输出。

## 4. 验收矩阵

每个组合记录 `PASS`、`FAIL` 或 `BLOCKED`，不得用软件 fixture 代填真实硬件结果：

- ALSA: PCM rates / bit depths / channels。
- ALSA: Native DSD（仅当产品路径明确支持该设备组合）。
- Diretta: PCM 已验证到 768 kHz 及其下支持 rate；release candidate 复验代表性 rate / bit depth /
  channels 与最高承诺 rate。
- Diretta: Native DSD 已验证到 DSD512 及其下支持 rate；release candidate 复验代表性 DSD rate /
  channels / equivalent bit order 与最高承诺 rate。
- 本地文件与在线 HTTP lossless materialization。
- 单曲开始/停止、三首 auto-next、ALSA ↔ Diretta output switch。
- 混合 PCM/DSD 过夜循环已完成；release candidate 记录最终 artifact 的短时连续播放、Track 数、
  错误/恢复次数和内存趋势即可，除非本次 release 修改了 playback/output lifecycle。
- 服务生命周期：systemd 目标机走 `systemctl start/stop/restart`；OpenRC 目标机（GentooPlayer）走
  `rc-service start/stop/restart`（`status` 退出码 0=started、3=stopped），两者的 SIGTERM、升级与回滚
  都要过一遍，见 [GentooPlayer（OpenRC）服务管理](./gentooplayer-openrc.md)。

## 5. 验收记录模板

```text
Result: PASS | FAIL | BLOCKED
Date/timezone:
Operator:

Artifact file:
Artifact SHA256:
Atom version / commit / sourceDirty:
Core protocol / Node variant / Node version:
Diretta capability / Host SDK release:

Distro / kernel / arch:
DAC / ALSA device id:
Diretta Target:
Source kind / codec / rate / bits / channels / DSD rate:
Expected DAC indication:
Observed DAC indication:

Auto-next observed / expected:
Output switch result:
Continuous-play duration / tracks:
Memory start / peak / end:
Failure step and exact sanitized error:
User-selected sanitized log attachment:
Notes:
```

记录中不得包含 cookie、token、Authorization、provider credential、最终 playable URL、不必要的私人路径或完整私有日志。若需要日志，只附验收者明确选择并完成脱敏的最小片段。
