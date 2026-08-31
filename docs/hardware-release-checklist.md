# SPlayer Atom Hardware Release Checklist

本文只记录真实音频主机的手工验收步骤。源码构建、fixture、fake ALSA/Diretta 与 final-artifact smoke 不能替代真实 DAC、Diretta Target 或 bitstream 证据。

## 1. 前置条件

- 使用从干净 checkout 生成并已通过 final-artifact smoke 的 Linux x86-64 Core `tar.gz`。
- system-runtime 使用 Node `24.18.0`；bundled-runtime 必须确认实际进程使用包内 Node。
- Diretta-branded artifact 必须记录 `diretta=true`、`direttaSdkRelease=150`，并由受控 SDK 150 gate 生成。
- ALSA 验收使用明确的真实 `alsa:hw:*` device，不以 `default`、PipeWire 或 PulseAudio 代替。
- Linux Diretta Host Core 以 root 运行；普通用户发现到 Target 不代表具备连接权限。
- 在 Web Control 中预先建立验收队列。诊断脚本不会插入、改写或清空队列。

建议队列至少包含：

- 两种以上源采样率的 lossless PCM，包含实际发行要承诺的最高 rate / bit depth / channel count。
- Native DSD，至少覆盖实际发行要承诺的 DSD rate 与 channel count。
- 三首连续曲目，用于 Core-owned auto-next 与 long-play。
- 一个在线 HTTP lossless Track，用于 Diretta exact-byte materialization。

## 2. 默认只读诊断

Core 默认地址为 `http://127.0.0.1:14558`：

```bash
pnpm check:hardware-release -- \
  --artifact out/splayer-atom-core-system-linux-x64.tar.gz
```

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
- Diretta: PCM rates / bit depths / channels。
- Diretta: Native DSD rates / channels / equivalent bit order。
- 本地文件与在线 HTTP lossless materialization。
- 单曲开始/停止、三首 auto-next、ALSA ↔ Diretta output switch。
- 连续播放时长、Track 数、错误/恢复次数、内存趋势。
- systemd start/stop/restart、SIGTERM、升级与回滚。

## 5. 验收记录模板

```text
Result: PASS | FAIL | BLOCKED
Date/timezone:
Operator:

Artifact file:
Artifact SHA256:
Atom version / commit / sourceDirty:
SPlayer accepted baseline:
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
