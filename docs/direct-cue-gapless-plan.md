# Direct CUE 无缝播放实施方案

本文记录 SPlayer Atom 的 Diretta Source Direct CUE 无缝播放方案及当前实现状态。

目标是解决 CUE 虚拟分轨在 Direct 路径上的边界泄漏、爆音、重复加载和切换不稳定，同时保持 Atom 现有的 Core 单一播放权威和 Source Direct 不变量。

本文只讨论 CUE、Diretta Source Direct、Native staging/handoff 与 Core 播放权威，不讨论 UPnP。

## 1. 最终结论

采用的架构是：

```text
Core：唯一 queue/index/repeat/shuffle/candidate 权威
Native：当前 Direct segment + 一个 staged candidate + 精确音频边界 + Diretta connection
Web：只发送高层命令、消费 Core 快照和事件
```

正常 Direct CUE 边界由 Native 精确完成：

```text
Native 精确结束当前 CUE segment
    -> 同一 Diretta connection/ring 切入 staged 下一 segment
    -> Native 记录一次 DirectTrackBoundary
    -> Core 提交 queue/index/now-playing
    -> Core staging 再下一首
```

正常 Direct CUE 不再依赖：

```text
Core position timer
    -> pauseImmediately()
    -> next()
    -> full load/reconnect
```

非 Direct 输出继续沿用原有 CUE 母版 + Core timeline 行为。

## 2. 关键不变量

实现必须持续满足：

- Core 是唯一的播放队列、当前 index 和播放策略权威；
- Native 不理解完整 queue、repeat、shuffle，也不创建第二套 scheduler；
- Web 不持有 Direct recovery 状态机；
- PCM 保持源采样率、声道数、有效整数 bit depth 和 sample value；
- Native DSD 保持源 bit rate、声道数和逻辑一位序列；
- 不为 CUE 边界引入 resample、remix、float DSP、软件音量、ReplayGain 或 fade；
- Native realtime callback 不新增分配、锁、日志、文件打开或格式协商；
- staging 失败只影响下一首预载，不中断当前正在播放的 Direct source。

## 3. CUE 精确坐标：75fps INDEX，而不是毫秒

CUE 的原始时间坐标是 `MM:SS:FF`，其中 `FF` 为 75fps。

Atom 以前只保存：

```ts
cueStartMs;
cueEndMs;
```

毫秒不足以描述 Source Direct 的精确边界。例如 44.1 kHz PCM 的一个 CUE frame 应严格等于：

```text
44100 / 75 = 588 samples/channel
```

如果先把 `00:00:01` 四舍五入成 13 ms 再换算，会得到约 573 samples，已经偏离 15 samples。

因此 canonical `Track` 现在额外保存：

```ts
cueStartFrame75: number
cueEndFrame75?: number
```

语义如下：

- `cueStartFrame75`：当前 Track 的 `INDEX 01` 原始整数坐标；
- `cueEndFrame75`：下一首 Track 的 `INDEX 01`；
- 最后一轨没有下一条 INDEX，因此 `cueEndFrame75` 省略，并直接播放到物理 EOF；
- `cueStartMs/cueEndMs` 继续保留给 UI、普通输出和兼容路径使用，但不能再作为 Direct 精确裁切的依据。

数据库 schema 已升级，并对旧 CUE 数据做一次迁移：

- start 可由旧毫秒值恢复到最近的 75fps INDEX；
- end 只有在同一 CUE 中确实存在下一条 `cueStartMs == current.cueEndMs` 时才回填；
- 最后一轨不会把物理 EOF 错当成下一条 INDEX。

旧 `playback_session` JSON 也可能没有 frame75 字段。恢复 session 时必须回到当前 library 的 canonical Track 补齐这些坐标，不能直接根据毫秒猜 end。找不到 canonical Track 时保留旧数据，但 Direct preload 会跳过精确 segment staging，避免错误截断。

## 4. Core staging 权威与 generation

不引入“全局唯一 generation”或新的调度层，而是继续使用现有几个各自职责明确的 token：

- `loadGeneration`：Core 当前 load / 旧 CUE timer 等 session 生命周期；
- `preloadToken`：当前下一首 preload 是否仍有效；
- `directGeneration`：某个 staged Direct candidate 的 boundary 身份；
- Native staging epoch：作废尚未进入 ring 的 staged candidate。

这些 token 不应强行合并。它们对应不同生命周期，保留现有职责反而更简单。

以下变化会使当前 preload/staging 失效：

- 手动切歌或停止；
- queue 修改、重排；
- shuffle/repeat policy 变化；
- 输出切换；
- 下一候选 Track 或其实际 source 改变；
- Direct policy 改变。

`buildPreloadKey()` 已包含 CUE 的 `cueStartFrame75/cueEndFrame75`，因此 CUE segment 本身改变也会使旧 candidate 失效。

## 5. Core -> Native segment 接口

本次没有新增伪路径，也没有为了“结构化”再建立额外 DTO 层。

现有 N-API 方法直接增加两个可选整数参数：

```ts
load(source, autoPlay?, cueStartFrame75?, cueEndFrame75?)
stageDirectNext(source, durationSecs, generation, cueStartFrame75?, cueEndFrame75?)
commitDirectGaplessBoundary(source, durationSecs, cueStartFrame75?, cueEndFrame75?)
```

这些类型由 napi-rs 自动生成到 `native/audio-engine/index.d.ts`，不手写第二份 Native addon 类型。

Native 自己根据已经探测出的实际 PCM sample rate / DSD bit rate 把 75fps INDEX 转换成原生单位，因此 Core 不需要提前知道解码后的 sample rate，也不需要把 `bigint sample frame` 作为另一种跨层协议。

## 6. 当前 segment 与 staged segment 使用同一语义

只支持“下一首 segment”仍然不够。当前正在播放的 CUE Track 从第一块音频开始就必须知道自己的精确 end，否则 producer 可以在 Core 后续下发 stop/end 之前预填母版后续数据。

因此 current load 和 staged load 都携带同样的 CUE segment：

```text
physical source
startFrame75
endFrame75 | physical EOF
```

Native producer 的行为是：

1. 以 segment start 打开或精确 seek；
2. 记录当前 segment 剩余的 PCM frames / DSD bits；
3. 每次填 ring slot 时扣减剩余长度；
4. 最后一个 slot 跨界时精确裁切 payload；
5. 剩余长度归零后，不再读取母版后续内容；
6. 有 staged candidate 时安装其第一块并标记 boundary；
7. 没有 staged candidate 时进入真正的 `Ended`。

不优化“同一母版共用同一个 decoder”。相邻 CUE Track 可以各自 stage 一个 decoder/reader；这比引入共享 decoder 生命周期和额外状态机更简单、更稳定。

## 7. PCM 精确边界

PCM 使用源采样率把 CUE INDEX 转成 sample frame：

```text
sampleFrame = cueFrame75 * sampleRate / 75
```

必须能够整除 75；否则说明这个 sample rate 无法精确表达该 CUE 时间点，Direct 路径明确报不支持，而不是四舍五入。

例如：

```text
44.1 kHz: 1 CUE frame = 588 samples/channel
48 kHz:   1 CUE frame = 640 samples/channel
```

PCM producer 已实现：

- 按目标 sample frame 精确 seek；
- segment-relative seek；
- 最后一块 `DirectPcmFrame` 的 tail trim；
- 同步修正 payload 长度和逻辑 samples/channel；
- ring 中不写入边界之后的 sample。

Direct PCM staged handoff 只在以下 wire/source 语义兼容时允许：

- sample rate 相同；
- channels 相同；
- effective valid bits 相同；
- storage bits 相同；
- integer sample format 相同。

不兼容时让当前 segment 正常结束，再由 Core 走 full reconnect/load。

## 8. Native DSD 精确边界

DSD 使用源 bit clock：

```text
bitsPerChannel = cueFrame75 * dsdBitRate / 75
```

除必须整除 75 外，还必须满足当前 Diretta Native DSD transport 的 `DSD_SIZ_32`：

```text
bitsPerChannel % 32 == 0
```

标准 DSD64 的一个 CUE frame 为：

```text
2,822,400 / 75 = 37,632 bits/channel = 4,704 bytes/channel
```

因此标准 DSD rate 的正常 CUE INDEX 可以按 Native transport 单位精确表达。

实现保持：

- 原始 DSD bit rate；
- 声道数；
- 逻辑一位序列；
- DSF/DFF 必要的 source bit-order -> 当前 wire bit-order adaptation。

source container 或 source bit order 不要求彼此相同，只要可以无损适配到已存在的 Diretta wire bit order。不能因为 DSF 和 DFF 表示方式不同就强制 full reconnect。

无法满足精确 75fps/32-bit 对齐时显式失败，不做 padding、静默丢 bit，也不转 PCM/DoP。

## 9. Direct CUE position 与 seek

普通 ALSA 等非 Direct CUE 仍使用原有绝对母版位置：

```text
engine position = cueStartMs + track-relative position
```

Direct segment 则改为 Native 自己暴露 segment-relative position：

```text
当前虚拟 Track 起点 = 0
```

因此 `playerTimeline.ts` 会区分普通 CUE 与 Direct CUE：

- 非 Direct：继续减/加 `cueStartMs`；
- Direct segment：position 本身已经是虚拟 Track 相对位置，不再重复减 start；
- Direct seek 接受 Track-relative 秒数，Native 再映射到 `physical start + relative offset`，同时保留当前 segment end。

这避免 gapless handoff 后 Core 对已经归零的 Native position 再减一次 CUE start。

`onNativePosition()` 对 active Direct segment 直接退出，因此 Core timer 不再参与正常 Direct CUE 边界。

## 10. Boundary、duplicate 与 stale

Native 的 boundary 表示“音频 handoff 已实际发生”，不是“准备发生”。

producer 会先把 staged candidate 的首块放入 ring；SDK callback 真正取到带 boundary 的首块时，Native monitor 才递增 transition count 并记录 generation。Core 的后台事件线程随后再把 `DirectTrackBoundary` 发给 JS，因此事件到达 Core 时 Native 已经切到下一 source。

由此得到两个重要结论：

### 重复 boundary

同一个 generation 必须幂等消费。Core 保存最后一次已处理 generation，重复事件直接视为已消费，不能再次推进 queue、统计或 scrobble。

### stale boundary

stale 不能简单“记录并丢弃”。因为收到这个事件意味着 Native 已经真实播放了旧 staged candidate。

当前策略是：

1. generation/candidate 能匹配 -> 正常提交 Core queue/index；
2. generation 已经提交过 -> duplicate，直接忽略；
3. 找不到对应 prepared candidate -> 视为真实 stale handoff，立即停止 Native 当前输出，再按 Core 当前 queue/repeat 权威恢复。

这种恢复路径只在竞态异常发生时使用，不是正常调度路径。

## 11. 手动操作、取消与 ring race

Core queue/policy 改变时会立刻：

- 递增 preload token；
- 清除 prepared candidate；
- 调用 Native `cancelDirectNext()` 使尚未进入 ring 的 staged candidate 失效；
- 必要时清理 materialized Direct input。

已经进入 ring 的 candidate 不能靠普通 mutex cancellation 安全撤回，因为 realtime callback 可能已经接近或跨过 boundary。为此保留第 10 节的 stale-handoff recovery，而不是在 callback 内增加复杂的 queue 重写状态机。

## 12. staging 失败和跨格式 fallback

staging 失败不影响当前曲继续播放。

当前 segment 到达精确 end 后：

- 有有效同格式 staged candidate -> Native gapless handoff；
- 没有 candidate -> Native `Ended`；
- Core 再按现有 queue policy 普通加载下一首。

以下情况不强行 gapless：

- PCM sample rate / channels / valid bits / storage/sample format 不兼容；
- PCM <-> DSD；
- DSD bit rate / channels 无法保持当前 wire transport；
- CUE 75fps 无法精确映射到原生 sample/bit 单位；
- source staging、下载或 materialization 失败。

正确性优先于“看起来无缝”。

## 13. 旧数据兼容

旧 library 数据通过数据库 migration 获得 frame75 字段。

旧 `playback_session` / renderer legacy queue 可能仍携带旧 Track JSON，因此恢复时会：

1. 找出 local CUE Track id；
2. 从当前 library canonical Track 重新取得 `cueStartFrame75/cueEndFrame75`；
3. 仅补齐精确 CUE 坐标，不覆盖 queue context 或其它播放元数据；
4. 如果 canonical Track 不存在，则不从毫秒猜 end；
5. 缺少 canonical 75fps 边界的 CUE Track 不参与 Direct preload staging。

这样既保证升级后旧队列可恢复，也不会把最后一轨物理 EOF 误解释为下一条 INDEX。

## 14. 当前自动化验证

截至 2026-09-16，已经验证：

- CUE parser 保留原始 75fps INDEX；
- 数据库 v6 migration 正确区分中间轨和最后一轨；
- 旧 persisted playback queue 可从 canonical library Track 恢复 frame75；
- PCM 44.1 kHz 的 1 CUE frame 严格为 588 frames；
- Native DSD64 的 1 CUE frame 严格为 37,632 bits/channel；
- 不可精确映射的 DSD bit rate 被拒绝；
- PCM/DSD staged handoff 保持现有 bit/sample contiguous 测试；
- `audio-engine-core` 单元和 integration test 全部通过；
- 带本机 Diretta SDK 的 `cargo check` 通过；
- 项目正式 `build:native --dev --require-diretta --diretta-variant=v3` 可以生成两个 native addon；
- Node TypeScript typecheck 通过；
- Direct/CUE/database 定向 Core 测试通过。

## 15. 仍需真实硬件验收

自动化测试不能代替真实 Diretta Host/Target。合并和发布前仍应在 Linux x86-64 真实设备上至少验证：

1. 三首以上 PCM CUE 连续 gapless；
2. CUE 边界前后没有可闻泄漏、爆音或重复开头；
3. DSD CUE 连续播放；
4. CUE -> 普通整曲、普通整曲 -> CUE；
5. 同格式 handoff 保持同 connection；
6. 跨 sample rate / PCM-DSD 时明确 full reconnect；
7. boundary 前后立即改队列时 stale recovery 不会继续错误播放；
8. segment 内 seek 后仍在正确物理位置并保持正确 end；
9. repeat-one、shuffle、手动 next/prev、stop；
10. 长时间连续播放没有 ring/source/connection 泄漏和重复统计。

## 16. 主要实现位置

Core：

```text
core/services/cue.ts
core/services/playerTimeline.ts
core/services/playerLoad.ts
core/services/playbackPreloader.ts
core/services/directGapless.ts
core/services/playbackSession.ts
core/database/migration.ts
core/database/playbackSession.ts
```

Native：

```text
native/audio-engine-core/src/direct_runtime.rs
native/audio-engine-core/src/direct_pcm.rs
native/audio-engine-core/src/direct_dsd.rs
native/audio-engine-core/src/diretta/mod.rs
native/audio-engine-core/src/player/mod.rs
native/audio-engine-core/src/player/background.rs
native/audio-engine/src/bindings/player.rs
native/audio-engine/index.d.ts
```

## 17. 合并前审查清单

- Web 没有第二个播放/队列权威；
- Native 没有完整 queue 或第二套播放策略；
- 没有新增 watchdog、固定时间窗口或全局静态 handoff 标志；
- Direct 精确边界只使用 75fps INDEX，不依赖毫秒反推；
- 最后一轨 end 为物理 EOF，不伪造 frame75；
- current 和 staged CUE 使用同一 segment 语义；
- PCM 最后 frame 会精确 tail trim；
- DSD 保持逻辑 bit sequence 并满足 `DSD_SIZ_32`；
- Direct segment position/seek 是 Track-relative；
- duplicate boundary 幂等；
- stale boundary 按“Native 已真实 handoff”处理；
- realtime callback 没有新增锁、分配、日志、发现或格式协商；
- staging/跨格式失败有明确 fallback；
- 没有为了形式对称新增 facade、adapter 或第二状态机。
