# SPlayer Atom Hardware Release Checklist

本文只记录真实音频主机的手工验收步骤。源码构建、fixture、fake ALSA/Diretta 与 final-artifact smoke 不能替代真实 DAC、Diretta Target 或 bitstream 证据。

## 当前已取得的开发期实机证据

以下能力已经在真实 Diretta Host / Target / DAC 链路完成，不再作为“未知能力”保留：

- exact PCM Source Direct 已完成 bit-perfect 实机验证，并覆盖到 PCM 768 kHz；其下实际支持的
  PCM sample-rate 档位均已完成播放验证。
- Native DSD Source Direct 已完成 logical one-bit sequence 的 bit-perfect 实机验证，并覆盖到
  DSD512；其下实际支持的 Native DSD rate 档位均已完成播放验证。
- PCM 与 Native DSD 混合格式队列已完成过夜循环长时间播放，连续 format transition 未观察到
  播放中断或格式切换异常。

这些结果属于当前开发期硬件基线。正式发布时无需重新证明实现原理，但仍必须使用准备发布的
**最终 clean artifact** 做一次 release-candidate hardware smoke，以证明发布包、native feature、
Diretta SDK 与已验证源码路径一致。

## 1. 前置条件

- 使用从干净 checkout 生成并已通过 final-artifact smoke 的 Linux x86-64 Core `tar.gz`。
- 正式构建使用 reference Node `24.18.0`；system-runtime 运行最低要求为 Node `22.19.0`，bundled-runtime 必须确认实际进程使用包内 Node。
- Diretta-branded artifact 必须记录 `diretta=true`、`direttaSdkRelease=150`，并由受控 SDK 150 gate 生成。
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
- systemd start/stop/restart、SIGTERM、升级与回滚。

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
