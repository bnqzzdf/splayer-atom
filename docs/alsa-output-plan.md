# ALSA 源保真播放完整实施方案

日期：2026-09-20。

状态：实施设计，代码尚未实现，硬件尚未验收。完成情况由 [Roadmap](./atom-roadmap.md) 维护。
本文按一个完整目标设计，不拆成先发布 PCM、以后补 DSD 或长期保留旧后端的交付批次。

已确认的产品要求：同一个 ALSA 后端提供“精确直通”和“PCM 处理”两种明确模式；保留
MP3/AAC 等有损播放以及现有 PCM DSP 功能。直通时不提供可操作的 DSP，PCM 处理时不
显示精确直通标识。播放主界面不新增常驻技术状态文字，允许小图标或不标识；详细信息
仅按需查看。本文其余细节是实施决策，不表示当前版本已具备这些行为。

## 1. 最终目标

Linux x86-64 Core 只保留一个 ALSA HW 后端，在其上游显式选择音频路径：

| 规则                                                           | 精确直通 `direct`                                          | PCM 处理 `processed`                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| 整数无损 PCM                                                   | 保留样本值、有效位深、rate、声道语义和序列                 | 可进入浮点 DSP，输出不承诺 bit-perfect                         |
| 有损/浮点 PCM                                                  | 保留解码 rate/声道，只有必要的表示适配；不标为 bit-perfect | 使用相同解码器，允许已启用的 DSP                               |
| Native DSD                                                     | 保留逻辑位序列、bit rate、声道；硬件不支持则失败           | 不支持；提示显式切换精确直通，不自动切换或转 PCM               |
| 软件音量、静音、EQ/preamp、归一化、ReplayGain、fade、变速/变调 | 无处理实例、无生效设置，命令拒绝                           | 保留现有功能，参数由 Core 保存和应用                           |
| rate/声道                                                      | 不重采样、不 remix、不补声道                               | 可为 PCM 设备适配重采样；本方案仍不增加 remix/补声道           |
| 削波保护                                                       | 禁止                                                       | 显式可开关，属于实际 DSP 状态；不再隐式全路径执行 0.98 limiter |
| 输出标识                                                       | 默认不常驻显示；可选小图标必须与当前实际保证一致           | 无需常驻文字；不显示直通图标，效果全关也不改为直通             |

“精确直通”是模式选择，“当前曲目是否精确直通”是运行事实，两者不能混用。有损音源在
direct 下允许原采样率解码和必要量化，以保留此前确认的播放支持，但没有 bit-perfect 徽标；
模式选择器的按需说明写明这个范围，不要求在播放区域逐曲显示技术说明。

两种模式共用同一设备身份、硬件协商、writer、缓冲所有权与播放生命周期；不能构建第二
ALSA 后端或 Core 播放器。只打开用户选择的 HW 端点，不跟随桌面默认，不接管系统 mixer。
Core 继续唯一拥有队列、音源、缓存、预加载、重试、跳过、统计、模式与 DSP 设置。Web
只发送高层命令、消费权威状态；Diretta 保持 strict Source Direct，UPnP 保持现有独立分支。

模式不由曲目格式、DSP 参数是否全零或设备支持情况自动推断。任何格式失败都不触发
direct→processed 的自动 fallback。两种模式均不引入 DoP/DSD-to-PCM。

最终删除旧 CPAL 输出、重复生命周期、欠载静音填充和隐式处理；保留并迁移有实际用户
功能的 DSP 算法及依赖。开发过程允许短暂并存以便比对，完成时不能留旧后端作隐藏 fallback。

### 1.1 bit-perfect 的边界

源文件与输出字节不必逐字节相同：FLAC 解码、planar→interleaved、整数槽位扩展、DSF/DFF
位序与打包适配可以无损。比较对象是统一表示后的有效 PCM 样本，或各声道的逻辑 DSD 位序列。

direct 模式的软件保证止于向已协商的 ALSA HW 接口提交的数据。驱动报告的精度、硬件数字 mixer、DAC
内部 DSP 和最终数字输出需要独立验收。实际软件路径保留在 Core 状态和输出详情中，
不强制变成播放器常驻文案；不凭设备名或采样率显示宣称端到端 bit-perfect 已验证。

有损解码器的结果不是压缩前原始录音；浮点到整数还可能发生量化或满幅饱和。Core 仍
区分这些路径，UI 可以完全不增加状态标识。源文件“无损/Hi-Res”标签不等于输出直通，
也不能以所有 DSP 开关关闭为依据补上直通图标。

## 2. 现有实现审计与保留判断

当前 `decoder.rs` 将解码结果送入输出设备格式的 `f32` resampler，再进入 DSP。
`process_audio_chunk()` 在 tempo bypass 时仍调用阈值为 `0.98` 的 `OutputLimiter`。
`audio_output.rs` 优先沿用设备默认格式/声道，不支持源采样率时回退默认配置，输出回调再次
执行软件增益和 `FromSample<f32>`。`source.rs` 在欠载时插入约 20 ms 静音。

因此“关闭音效并把音量调到 100%”不能使当前链路满足目标。CPAL 本身不等同于有损输出，
但本项目只有 Linux 目标，而新实现需要直接掌握 HW 身份、有效位、Native DSD、短写和
设备排空语义；保留 CPAL 会增加第二套本地设备与生命周期实现，没有独立产品用途。

| 现有代码/职责                                             | 最终处理                                       | 理由与必须保留的部分                                                               |
| --------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| `audio_output.rs`、CPAL 依赖                              | 删除；由唯一 `alsa/` 后端替代                  | 两种模式共用设备枚举、稳定 ID、协商与 writer                                       |
| `playback.rs` 的 `PlaybackHandle`                         | 删除旧实现；承载合并后的 native runtime        | 软件音量迁入 processed producer，输出回调不再拥有增益                              |
| `source.rs`、`shared.rs`                                  | 删除旧播放队列、消费计数和静音填充             | 两种模式输出都进入新的有界样本块队列；processed 的浮点 scratch 仍可存在            |
| `decoder.rs`                                              | 拆出探测、解码与可复用处理步骤，删除旧线程编排 | 元数据、解码器和处理能力保留，不能整体删除功能                                     |
| `direct_pcm.rs`                                           | 保留并改造                                     | 精确整数解码、重排、seek、CUE/staging；共享 FFmpeg 底层                            |
| `direct_dsd.rs`                                           | 保留并改造，仅 direct 使用                     | 解耦容器逻辑序列与 transport 分组，保留 strict 约束                                |
| `direct_runtime.rs`                                       | 合并进唯一 native runtime 后删除旧文件         | 避免 normal/direct 两套完整播放器                                                  |
| `player/mod.rs`、`transition.rs`、`background.rs`         | 保留控制职责，精简重复状态/线程                | 保留 load token、输出代次与事件；DSP 状态只属于 processed，fade 改为处理图中的包络 |
| `equalizer.rs`、`loudness.rs`、`tempo.rs`                 | 保留算法和必要依赖，适配 processed             | 包括 `signalsmith-stretch`；direct 不实例化、不调用这些处理                        |
| `OutputLimiter`                                           | 移出普通解码器，改为 processed 显式削波保护    | 不能成为所有音源必经步骤；保护开关和实际生效状态可见                               |
| 播放 resampler                                            | 迁移为 processed 专属 PCM rate 适配            | 不在 direct 的整数/DSD 路径初始化，也不偷偷 remix                                  |
| `fft.rs`                                                  | 保留，只读分析旁路                             | direct 分析样本副本，processed 分析处理结果；不回写音频                            |
| `device_watcher/`                                         | 删除占位后端与 watcher 接口                    | 当前固定返回不支持；显式刷新和输出错误承担实际职责                                 |
| `core/services/device.ts`                                 | 精简为固定端点恢复协调                         | 保留有界恢复与取消，重建时携带模式和处理参数                                       |
| `metadata/`、`scanner.rs`、`cue/`、`sacd/`、`dsd/` reader | 保留                                           | 扫描、标签、封面、歌词、分轨、DST/DSD 仍有真实消费者                               |
| `media_extract.rs`                                        | 保留，与处理模式隔离                           | UPnP strict extraction 不得经过 DSP/量化                                           |
| `dsd/dsd2pcm.rs`                                          | 删除转换器及专属测试                           | 两种模式都不接受 DSD-to-PCM，不删除整个 `dsd/`                                     |
| `midi/`、`rustysynth`、`midi` feature                     | 删除未接入的合成实现                           | 当前未发现生产调用；两种模式不扩大为 MIDI 产品                                     |
| `hdcd/`、`mqa/`、`dts/` 独立处理/检测模块                 | 删除无生产消费者的模块与专属测试               | 当前只有独立测试引用；保留真实格式识别/标签/解码消费者                             |
| `error.rs`                                                | 保留分类，替换 CPAL 分支，增加模式冲突原因     | 模式不可用、设备错误不能误归为网络故障                                             |
| Core resolver/session/cache/provider/stats/ListenBrainz   | 保留并接入新 runtime                           | 不重建业务播放系统；时间与生效状态从同一 authority 得到                            |

审计结论以本次仓库调用关系为依据。实施删除前再次检查生产引用、feature 和测试，发现真实
消费者时先迁移职责；“文件还在”和“有自己的单元测试”都不是保留运行时功能的充分理由。
MQA/HDCD 标记的 PCM 可按实际整数音源精确输出，但不承诺展开/解码这些附加编码；DTS 解码
按实际 codec 判断有损/无损；不因 DTS 名称而误判 DTS-HD MA 等变体。IEC61937/SPDIF
压缩码流 passthrough 不在本次范围。

## 3. 最终模块结构

```text
Core playbackSession / resolver / preload / cache
                         |
                 已准备的本地输入与分轨边界
                         |
                  native AudioPlayer
                         |
               唯一 PlaybackRuntime
                 /                 \
             ALSA 路径          Diretta strict 路径
           /          \               |
     direct         processed         |
  精确 PCM/DSD     PCM 解码 + DSP      |
  或无 DSP 解码         |              |
           \          /               |
        同一个 ALSA transport     Diretta transport
             |                        |
          所选 HW                  所选 Target
```

目录按真实职责组织，不建立通用输出插件框架：

```text
native/audio-engine-core/src/
  alsa/
    mod.rs          本地 transport 入口
    device.rs       HW 枚举、身份解析与受约束打开
    format.rs       参数协商、PCM/DSD 槽位适配
    output.rs       单所有者写入线程、命令、进度与 drain
  pcm_decode.rs     从现有 direct_pcm 提取的 FFmpeg 打开/解码/精确 seek
  pcm_processing.rs processed 处理编排、参数快照、时延/媒体时间映射
  equalizer.rs      现有 EQ 算法，仅 processed 使用
  loudness.rs       现有归一化分析，仅 processed 使用
  tempo.rs          现有变速/变调，仅 processed 使用
  direct_pcm.rs     整数精确约束、源块、分轨与 staging
  direct_dsd.rs     DSD reader、源块、分轨与 staging
  playback.rs       由现有 DirectPlayback 演进的唯一 PlaybackRuntime
  media_probe.rs    从 decoder 拆出的元数据探测，无输出与 DSP 依赖
  diretta/          现有 SDK transport
  player/          N-API 之下的控制、加载代次和事件协调
```

`PlaybackRuntime` 用有限枚举持有 `Alsa`、`DirettaPcm`、`DirettaDsd`。共同操作仅覆盖
现有 load/play/pause/stop/seek/stage/monitor，具体设备语义留在 transport。不要引入
Output registry、第二个 Core session、多个活动播放器或独立 output daemon。

FFmpeg 底层可以返回整数/浮点及 packed/planar frame；严格整数 adapter 仍只接受精确整数
表示。ALSA 在 producer 层选择 direct adapter 或 processed 处理图，再进入相同 ALSA
transport。模式是该次 load 的不可变执行参数，不能在 writer 中依据一个布尔开关临时
把整数流改解释为 float。不复制整个解码器，不向 Diretta/UPnP strict extraction 放宽约束。

处理图复用已存在算法；允许 processed 内部使用 `f32`，但它不拥有设备和队列。软件音量、
fade 与保护在 producer 侧完成；writer 仅消费最终样本块。两模式共用相同输出控制代码，
测试不能只证明“入口不同”，还必须证明 direct 未经过任何处理实例。

通用 runtime、PCM/DSD reader、load/seek/staging 不依赖 Diretta feature。只有 SDK
transport、发现、连接和专属等待逻辑受 `feature = "diretta"` 控制。现有 800 ms Diretta
重连稳定窗口不能因为合并 runtime 而应用到 ALSA。

## 4. 音源支持与格式协商

### 4.1 音源矩阵

下表定义 direct 的源保证范围；processed 对可解码 PCM 使用第 4.6 节，不继承精确样本
承诺。有损/浮点在两个模式均支持，Native DSD 只在 direct 支持。

| 音源                                                    | 处理与保证                                | 不满足时                                   |
| ------------------------------------------------------- | ----------------------------------------- | ------------------------------------------ |
| WAV/AIFF 整数 PCM、FLAC、ALAC、APE、lossless WavPack 等 | 无损解码；精确整数输出                    | 不降有效位、不转浮点后量化；报格式不支持   |
| MP3、AAC、Vorbis、Opus 等当前 FFmpeg 可解码有损格式     | 解码后原采样率/原声道；必要时一次格式转换 | 不支持该 rate/channel 时明确失败           |
| 浮点 PCM 文件                                           | 保留解码采样率/声道；走显式 PCM 适配      | 不显示整数无损直通标记                     |
| DSF、DFF raw DSD、已支持的 SACD/DST 虚拟音轨            | 无损读取/解压，Native DSD 输出            | 不转 PCM/DoP；无匹配 Native DSD 格式则失败 |
| WavPack hybrid 等混合编码                               | 依据实际解码模式/校正数据确定是否无损     | 不按扩展名假定无损；不确定时不标为精确源   |
| MIDI、不可解码/未知编码、未支持的 DST 容器变体          | 不凭模块存在宣称支持                      | 明确 unsupported，不启动旧路径             |

分类依据 codec、实际解码格式与有效位信息，不能依据 provider 的“无损”标签、URL 后缀或
文件容器。Opus 等使用解码器实际输出 rate；不拿容器里的提示 rate 强制转换。

### 4.2 PCM 协商算法

以下精确约束适用于 direct；两模式使用同一个协商实现，由显式 policy 决定是否允许
PCM 重采样/量化。ALSA 插件层的自动转换在两模式中均关闭。

1. 探测并解码首个有效 frame，取得源 rate、声道布局、样本表示、有效位及其可信度。
2. 按源类型生成有限候选格式，严格保持 rate 和声道语义。
3. 对每个候选联合约束 format/rate/channels/access，再设置 period/buffer；不能把分别
   查询到的支持列表当成所有组合都支持。
4. 使用精确 rate 设置，禁用 ALSA 自动 rate/channel/format 转换；period/buffer 可以
   在设备允许范围内调整。若 API 使用 near，必须验证 rate 结果完全一致，否则失败。
5. 提交 hw/sw params 后读取实际配置与有效位。所有关键字段通过校验才开始写入。
6. 正在播放的源格式变化要停止旧配置并重新协商，不能在旧格式下继续解释新 frame。

支持 8/16/20/24/32-bit 常见整数源。U8 可通过减去偏置和精确扩位表示；20/24-bit 必须
区分有效位和存储位。超出该整数范围的音源明确不支持，不偷偷按 32-bit 截断。

PCM transport 至少实现 `S16_LE`、`S24_3LE`、`S24_LE`、`S32_LE`；设备支持时可原样
使用相应浮点格式。整数优先不需额外重排且足够精确的格式，再尝试其它无损表示；不为了
避免格式重开而永久固定成某个 rate、立体声或 32-bit 输出。

整数适配采用明确的算术与字节打包，不使用泛型浮点 cast：若有效 N 位样本值为 x，目标
格式数值宽度为 M，则按该格式的有效位位置精确缩放为 `x × 2^(M-N)`，使用足够宽的中间
整数防溢出。FFmpeg 中已左对齐的有效样本必须先按其已知表示解释，不能重复左移。
`S24_LE` 的 24 个数值位在 32-bit 存储槽低三字节；`S32_LE` 的数值位宽为 32，两者不能
仅因同占 4 字节而直接互换。[ALSA PCM 格式说明](https://www.alsa-project.org/alsa-doc/alsa-lib/pcm.html)

设备的 `sbits` 必须足够保留源有效位；例如 S32 槽位仅报告 24 个有效位时，24-bit 源可以
按正确对齐输出，32-bit 源必须失败。有效位未知时不扫描整曲来猜测：源按解码表示的完整
宽度保守要求，设备无法确认精度则严格路径失败，并给出具体原因。
[ALSA 硬件参数](https://www.alsa-project.org/alsa-doc/alsa-lib/group___p_c_m___h_w___params.html)

### 4.3 有损与浮点 PCM 的唯一适配点

本节规定 direct 下有损/浮点的最小表示适配；processed 另行经过已选择的 DSP 图，最终
整数打包复用相同工具，不能同时应用两遍量化/增益。

有损解码结果可能是 float/planar；FFmpeg 不以单独的 24-bit C 样本类型表示 PCM，且浮点
样本可能超出满幅范围。不能直接把当前只接受 S16/S32 的 strict frame 结构套给所有音源。
[FFmpeg 样本格式说明](https://ffmpeg.org/doxygen/trunk/group__lavu__sampfmts.html)

有损/浮点 adapter 在 producer 线程交错声道并写入协商好的输出表示。优先保持解码器样本
表示；硬件只接受整数时，选择该 rate/channel 下最高可信有效精度，进行一次确定性的量化。
浮点转 B 位有符号整数使用足够宽的计算、明确的 round-to-nearest-ties-even 和满幅饱和；
NaN/Infinity 视为坏输入。不得借此引入 0.98 limiter、动态增益、抖动或整段峰值归一化。
记录是否发生量化/饱和，供诊断和输出状态展示，不在热路径逐样本打印日志。

整数有损解码结果在硬件位宽足够时精确传输；位宽不足时允许同一个已标识的有损 adapter
执行一次确定性量化。这个允许条件只能由实际音源类别决定，不能把无损源在硬件不支持时
降级归入有损路径。浮点文件也明确属于适配输出，不冒充整数精确直通。

ALSA 有损支持不扩展 Diretta 的接受范围：Diretta 继续既有 strict Source Direct 规则，
不自动借用这个量化 adapter；UPnP 仍遵守自己的原字节/严格提取规则。

### 4.4 声道

保留当前产品已可解码的 mono/stereo/multichannel PCM；目标硬件必须支持同样声道数和
可确定的声道映射。只允许为已知布局做保持声道语义的排列，不复制 mono、不下混、不补
额外声道。多声道布局未知或无法确认设备映射时失败；不能仅凭 `channels == channels`
就视为布局一致。SACD 继续当前已支持的 stereo area，不借此扩大 SACD 多声道范围。

### 4.5 Native DSD

支持 ALSA `DSD_U8`、`DSD_U16_LE/BE`、`DSD_U32_LE/BE` 中设备实际接受的组合。
这些是独立 DSD 格式，不能把数据写入同宽整数 PCM 格式冒充 native。
[Linux ALSA 格式定义](https://github.com/torvalds/linux/blob/master/include/uapi/sound/asound.h)

分别记录每声道 DSD bit rate R 与每个 ALSA frame/声道承载的位数 W，ALSA 配置 rate 为
`R / W`。例如 DSD64 在 U32 下是 88,200 frame/s，在 U8 下是 352,800 frame/s；Web
仍显示 DSD64/2.8224 MHz，进度按已播放逻辑位数/R 计算，不能误标为 PCM 88.2 kHz。

容器位序、word 字节序、声道交错分别适配，映射由格式定义和已知位序测试共同约束。
不能把 `_LE/_BE` 当作 DSF 的 LSB/MSB 位序开关。读者输出与 transport 打包分离：
ALSA 不继承 Diretta `DSD_SIZ_32` 的限制，Diretta 仍保留自己的 32-bit wire 约束。

每个源/分轨的首尾必须按所选 W 完整表达；先尝试更窄的设备格式。仍无法精确表达时拒绝
该组合，不截掉尾位或补造静音凑齐。seek 可以落到最近的合法设备 frame 并报告实际位置；
这与不能悄悄移动 CUE 音轨定义的精确边界是不同要求。

### 4.6 PCM 处理模式

processed 保留现有软件音量/静音、EQ/preamp、ReplayGain/响度归一化、fade、变速、
变调与 pitch-sync。已禁用的效果旁路，不因恢复播放而改写用户参数。新增明确的“削波
保护”开关承接原 limiter；关闭后只在最终整数转换处做必要的满幅饱和，不保留隐式动态
限幅。新安装与旧配置迁移均默认开启该保护，UI/运行状态明确显示，可由用户关闭。

处理次序固定为：源解码与分轨裁剪 → float/已知声道排列 → 归一化或 ReplayGain →
EQ/preamp → tempo/pitch → 必要的输出 rate 适配 → 软件音量/静音与 fade → 可选削波
保护 → 最终格式转换 → 唯一 ALSA writer。归一化有有效 ReplayGain 时只用对应固定
增益，否则用现有响度分析，不能将两种增益叠加。音量和 fade 只应用一次。

优先采用源 rate；硬件不支持时允许在 processed 中采用同声道布局下设备可用的 rate，
优先设备首选 rate，否则从可用离散候选中按距离源 rate 最近、同距离取较高 rate 的规则
选择。该选择必须显式反映在 source/device 状态，不称为原采样率直通；direct 不使用
这条策略。输出选择可按实际硬件精度量化，仍不借 ALSA plug 隐藏转换。

所有实例按源/设备 rate 与真实声道数配置；多声道算法不支持时明确报错，不只处理前两个
声道或静默下混。参数更新通过完整且有版本的快照到块边界生效，不在每样本处理中获取
Core/player 锁。切歌、seek 和重开重置所属效果历史，EOF 正确排空 tempo/resampler
尾部；保留其必要状态直到有效输出完全排空。

同格式连续播放可复用流和需要连续运行的处理状态，但归一化的曲目增益与元数据在对应
样本边界切换。fade 仅用于现有启停行为，不增加交叉混音；紧急 stop/取消仍立即 drop。
参数实时更新不改变模式，processed 全部效果关闭时仍是 processed，不动态升级为直通。

processed 不支持 Native DSD。播放 DSD 或尝试把正在播放的 DSD 切到 processed 时，
Core 在破坏旧 runtime 之前拒绝并给出“Native DSD 需要精确直通模式”；不自动转 PCM、
换模式、忽略 DSP 继续播放，或在 PCM 处理标签下发送 Native DSD。

## 5. 设备身份、打开与缓冲

沿用 `AudioDevice` 与 `alsa:hw:CARD=<id>,DEV=<n>`，从 ALSA control 接口枚举真实 playback
PCM。解析后使用受控 HW 配置打开并核验 PCM 类型/设备信息，避免仅检查名字前缀，却实际
打开用户配置中的 plug/softvol 别名。ALSA 官方将 HW 定义为直接访问内核且不转换的插件。
[ALSA HW 插件](https://www.alsa-project.org/alsa-doc/alsa-lib/pcm_plugins.html)

不持久化会随枚举变化的 card index。继续使用命名 card ID，但不把它夸大为永久唯一 USB
硬件序列号；重名/身份歧义时要求重新选择，不悄悄选择第一个同名设备。显示名只用于展示，
旧名字只在唯一匹配时迁移。旧 `default`/`plughw` 选择失效，保持未选输出状态。

`outputDevice = null` 表示未选择，删除“系统默认”的注释与行为。保持已有首次启动只有
一个唯一 HW 候选才自动选择的规则；已选择设备丢失后不能套用首次选择逻辑换到另一设备。
ALSA `isDefault` 不再代表桌面默认，返回 false。设备列表刷新不能暂停/重开当前音频设备。

采用直接 `alsa-lib` 调用，优先使用 Rust `alsa` crate；只有绑定缺失时补局部 FFI。
`RW_INTERLEAVED + nonblocking writei + poll` 是本方案基线。独立线程持有 PCM handle，
控制命令经有界通道和唤醒 fd 送达；不让 Node 线程和 writer 同时调用同一 PCM handle。

起始调度参数为约 10 ms period、约 100 ms hardware buffer，在设备实际范围内协商并
记录结果；这些是缓冲目标，不是强制格式条件。producer ring 按协商 buffer 和最大帧块
预分配，设置帧数与字节数上限；格式改变时在控制阶段重建，不在 writer 中扩容。默认不
暴露“音质调优”开关，调度参数变化也不能改变源 rate。

在已有预缓冲足够后显式 start；短于缓冲的文件按真实长度启动/排空，不能死等高水位。
关闭应用可控制的 silence insertion，正常欠载转入错误；不依赖 ALSA 的自动静音填充来
伪装连续输出。启动阈值、停止阈值、silence 与 drain 行为要显式设置并读回。
[ALSA 软件参数](https://www.alsa-project.org/alsa-doc/alsa-lib/group___p_c_m___s_w___params.html)

## 6. 缓冲所有权、播放进度与生命周期

### 6.1 不能原样复用 Diretta callback 协议

现有 Direct ring 的 `next_block()` 会释放上一块，`release_in_flight()` 按整块累加
consumed frame；track boundary 在取块时切换。ALSA `writei` 可以只接受块的一部分，
而已提交的块还可能在内核缓冲中等待播放。这两种语义必须分离。

- 从现有 ring 提取安全 Rust consumer API：取得块 lease、读取只读视图、显式归还；
  Diretta C callback 是其薄适配，不通过 `*mut c_void` 驱动 ALSA。
- lease 保证当前块写完前 producer 不覆盖；ALSA writer 保存 frame offset，短写只推进
  实际接受数量。取消前先让 writer 停止引用，再归还/析构块，禁止跨 generation 悬空引用。
- 整数 pack/DSD 位序适配/浮点量化在 producer 或有界准备阶段完成。writer 仅等待、提交
  已备数据、推进计数、处理轻量命令；不解码、分配、获取 player 大锁或进行发现与日志 I/O。
- processed 的 DSP 与 fade 也只在 producer 中执行；块携带模式/参数版本和媒体时间映射。
  不能把保存 DSP 参数的锁带进 writer；有界预处理量同时约束参数生效延迟。
- ring slot 释放只代表可以复用内存；不得同时把它解释为已由 DAC 播放。
- `Pending`、真实 EOF、解码失败、取消必须是不同结果；`None` 不能同时承担这些语义。

### 6.2 时间与曲目边界

ALSA transport 分别维护 submitted frame、设备 delay 和已播放估计。正常状态下
`played = submitted - delay`，按设备状态约束到合法区间；负值、XRUN 后的无效 delay
不能硬套公式。direct 的 PCM 位置按源 rate 换算；DSD 按逻辑 bit rate 换算。
processed 还须通过每个输出块的源 frame 范围、变速段与处理延迟映射到媒体时间，不能
简单使用 `played / outputRate` 作为歌曲进度，也不能按最新 speed 回算整段历史。位置
同时包含 seek base 和曲目起点，seek/重开/模式切换建立新时间 epoch。

staging 带入的 track generation 与边界记录在输出时间线上。只有已播放位置越过边界时
才发布 `directTrackBoundary` 给 Core，不能在读到下一首或写入内核时提前切歌词/统计。
很短曲目可能在一个轮询周期内跨越多个边界，必须逐一消费有界边界记录，不重复使用
“最后一个 generation”。Core 仍决定下一首，native 只接受 Core 已准备的 staging。

解码 EOF、ring 空和设备 drain 完成是三个不同阶段。只有真实 EOF 且所有有效样本完成
排空后发送一次 `Ended`。截断/解码失败即使发生在曲尾 3 秒内，也不能套用旧链路的
“按正常结束处理”容错来掩盖错误。

processed 在其间还有 tempo/resampler 的有效尾部排空阶段；结束事件与曲目边界要计入
处理延迟。处理参数版本只有对应样本进入实际播放区间后才称为“正在生效”，此前可展示
已接受/待应用；量化/保护等不能错误继承上一首诊断。统计仍按媒体时间和实际播放状态计算。

### 6.3 操作语义

| 操作           | 必须实现的行为                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| load           | 探测/准备源，取消过期任务，停止并释放旧输出，打开/预缓冲新输出；commit 前检查 token                              |
| play           | 启动已准备配置；direct 绕过 DSP，processed 按已确认参数执行启停包络，不改写保存值                                |
| pause/resume   | 先执行模式允许的启停包络；硬件 pause 保留队列，否则停止新写入并排空后暂停，保留未写块供 resume；direct 不做 fade |
| seek           | 停止引用旧块、drop 旧缓冲、flush 解码并精确定位；预缓冲后恢复原播放意图；返回实际位置                            |
| stop           | 立即取消 producer/staging、drop 设备缓冲；可唤醒阻塞等待，不等待整曲 drain                                       |
| 同格式 gapless | 共用 PCM handle；检查 transport、mode 和处理配置兼容性，使用所属模式的时间/边界映射                              |
| 异格式切歌     | 排空所属路径的有效尾部并重新协商；direct 不重采样，processed 只按明示策略适配；均不自动换模式                    |
| 输出切换       | 目标准备尽可能先完成，提交切换时先停旧输出再打开新输出；始终只有一个活动输出                                     |
| 切换失败       | 明确报告所选目标不可用并保持停止/暂停；不无声地恢复旧设备或换默认设备                                            |
| 设备热拔插     | writer 报设备错误，释放资源；刷新列表/用户重试可以重新打开同一明确端点                                           |
| SIGTERM/重启   | 发取消并唤醒 writer，按有界时间等待退出，清理本进程临时资源；不在主线程持锁 join                                 |

没有硬件 pause 的设备，暂停会等待当前已提交缓冲播放完，延迟约为实际待播缓冲时长；
界面收到完成事件后再显示 paused。这个等待只针对已提交数据，可被 stop/seek/新 load
取消，并受 drain 超时约束。不能先读取估计位置再 drop，然后声称可无误差恢复尚未播放
样本；设备指针观察与 drop 之间存在竞态。暂停期间保留源/输出格式与未写数据，producer
受有界背压限制；stop 与输出切换负责释放硬件。

有损 gapless 必须正确处理解码器 encoder delay/padding/skip-samples 元数据，并保证只
裁剪一次；seek 回放定位采用同一时间基准。没有相关元数据的源不承诺消除编码自身间隙。

### 6.4 CUE、SACD 与精确定位

CUE 继续由 Core 传入原始 75fps 整数边界，native 将边界一次性映射到源 sample frame，
使用既有统一舍入规则与 `[start, end)` 区间。相邻轨共享同一个边界值，不分别以浮点
毫秒计算长度，避免一帧重复或遗漏；映射不可精确落在时间点时明确采用该统一样本边界，
不声称具有超出源采样精度的时间分辨率。

FFmpeg seek 只把解码器定位到可恢复的包/帧；继续解码并精确丢弃目标之前的有效样本，
不能将粗粒度 packet seek 当作最终播放位置。EOF、encoder delay、CUE 截断共用同一有效
样本坐标，实际 position 在 Core 边界转为毫秒。SACD 复用现有 track reader/DST 解压，
不先物化成 PCM；DSD 分轨再校验第 4.5 节的 transport 对齐。

## 7. 错误与恢复策略

在现有 native 错误分类和 Core `ErrorCode` 中增加必要的稳定 reason，不靠字符串关键词
判断。沿用当前错误事件/响应 envelope，携带 output generation 与安全的格式信息。

| 情况                             | 行为                                                              |
| -------------------------------- | ----------------------------------------------------------------- |
| `EAGAIN`、可重试 `EINTR`、短写   | writer poll/继续未写部分；不丢块、不重复写、不生成静音            |
| rate/channel/format/sbits 不匹配 | `unsupported_output_format`，停止该次 load，展示源与设备不匹配项  |
| 设备不存在/被占用/权限不足       | 设备类错误，停止；不当作 URL 失效或无限跳曲                       |
| XRUN、suspend、运行中设备失效    | 中断该次连续播放，上报设备类原因；不调用 recover 后假装全程无中断 |
| 坏源/解码失败                    | 音源类错误；Core 复用现有有界重新解析/跳过策略                    |
| 网络物化失败                     | Core 按网络/音源原因处理，不创建 ALSA stream 掩盖下载失败         |
| 新 load/seek/stop 覆盖旧任务     | 正常取消；旧任务不再提交状态、错误或结束事件                      |

设备格式/位深不支持默认停止并提示，不自动以另一曲目绕过用户刚选择的播放失败。
`outputFailed`/`outputStalled` 不再一律进入当前 `requestReinit()`；按 reason 决定是否允许
一次 Core-owned 恢复，确定性格式失败、XRUN 与热拔插默认等待用户重试。若以后允许自动
恢复，也必须发布中断并建立新播放 epoch，不能保留“本次连续流完整”的诊断结论。

无隐藏的 native 重试/跳过循环；Core、native 各自只处理所属层，避免二者同时重建。

## 8. Core 音源、预加载和缓存

继续使用 `playbackSourceResolver.ts`、`playerLoad.ts`、`playbackPreloader.ts`、
`directGapless.ts`、现有 provider/DASH 物化与 `exactInput.ts`，不新建 ALSA 下载器。

本方案采用现有 Direct 的完整本地 seekable 输入契约：在线有限曲目先完成原字节物化或
命中完整缓存，再 native load；下一首由 Core 预备。FM 仍是 Core 提供的有限 Track 队列。
这是明确的首播延迟取舍，界面显示正在准备音源，取消必须及时生效。无限直播/渐进式
HTTP reader 不属于本次契约，不使用永远等待 EOF 的方式假装支持；未来扩展也不得复活
CPAL 输出和旧线程编排。未知 Content-Length 本身不等于直播，应结合源能力及超时/体积约束处理。

复用的同时必须补齐以下资源约束：

- 用 shared helper 表达 native 源准备能力，替换确实代表该能力的 `diretta:` 判断；
  SDK 发现、root 检查、Target 协商继续 Diretta 专属。
- 优先复用歌曲缓存和 resolver 已物化的文件，同一 URL/Track 的并发准备去重；provider
  凭据与解析仍在 Core。实际 codec 从内容探测，不依赖临时文件后缀。
- 临时路径经 Core 统一路径 helper 管理。当前 `directInput.ts` 的进程 `/tmp` 目录与
  `pruneDirectInputs(keepPath)` 需要调整：保护 current、staged、in-flight 和切换中的文件，
  不能为了清理当前之外的文件而删掉下一首。
- 临时缓存定义字节上限、过期清理、崩溃残留清理与引用生命周期；只能回收本模块拥有且
  无引用的文件，不把用户本地源或持久歌曲缓存误删。空间不足明确失败。
- stop/换曲取消本次不再需要的下载；不能取消仍被另一有效准备引用的去重任务。
- `.part` 原子完成、非空/响应完整性、超时与总大小限制一起验证。仅非零文件长度不足以
  证明源完整；不要在 strict EOF 后容忍截断。诊断日志不输出 provider 最终带凭据 URL。
- Core 只 stage 已选中的下一首；取消/改队列使旧 staging generation 失效。
  同格式候选准备失败不能打断当前曲目，边界后由 Core 按现有策略处理。

不要为了保持首播流式体验，把所有精确解码回退到旧 HTTP→f32 路径。接受本方案的本地输入
契约，也不代表删除其他非播放功能仍需要的 HTTP/FFmpeg 依赖。

## 9. 模式、控制协议、Web 与配置迁移

### 9.1 Core 模式与参数权威

在 `PlayerSettings` 增加 `alsaPlaybackMode: "direct" | "processed"`，仅表示 ALSA 已确认
的模式偏好，切换到 Diretta/UPnP 不覆盖它。继续使用现有 volume/EQ/normalization/fade
配置保存 processed 参数；复用现有速度/音调状态，不为了双模式新增另一套重复 settings。
需要保留跨模式恢复值的瞬时参数由 Core 持有，不能只放在 Web localStorage。

保存参数与生效参数分开：direct 的软件增益恒为 unity、speed 恒为 1、所有效果均不生效；
processed 恢复已保存的配置。进入 direct 不必先清空 EQ 预设或改写存储音量为 100%。
native 只接收当前模式可用的执行配置，仍做严格校验；这不是让一套 DSP 实例带着旧参数
“宣称旁路”。更新 Diretta preflight 时，也要区分已保存的 processed 配置与实际活动的
处理图；Diretta 的 unity/无 DSP 约束不变，不应被休眠配置误阻止。

Core 通过现有 HTTP/WS 命令通道提供明确的模式切换命令（例如 `POST /player/alsa-mode`），
不使用通用 settings 写入直接改 mode。通用设置入口必须路由到同一切换事务。模式切换、
输出切换、load/seek 共享既有串行协调与 generation 机制；DSP 参数命令也经过同一权限
和版本校验。Web 不能先写 Pinia 再指望 native 随后追上。

### 9.2 运行态、控件能力与标识

在现有 `PlayerStatus` 中增加统一的 `output` 运行态投影，并用于 HTTP snapshot 与 WS
status。结构在 `shared/types/` 定义；native 类型直接从 `@splayer/audio-engine` 导入：

```text
deviceId / backend
configuredAlsaMode: direct | processed
requestedAlsaMode: direct | processed | null
activeMode: direct | processed | null
phase: idle | preparing | ready | failed
revision / generation
path: exact-pcm | native-dsd | decoded-pcm | processed-pcm | null
source: codec / sampleRate 或 dsdBitRate / channels / validBits（适用时）
device: format / frameRate / channels / significantBits（适用时）
adaptation: none | lossless-pack | quantized | resampled
processing: 实际生效的音量/静音、EQ/preamp、归一化、fade、速度/音调、保护与 rate 适配
controls: canSelectAlsaMode / canConfigureDsp / canSetVolume / canSetTempo / canUseFft
integrity: exact-pcm | native-dsd | not-exact | unknown
clipped: boolean
```

`configuredAlsaMode` 是成功提交的偏好，`requestedAlsaMode` 只在切换中存在；`activeMode`
是实际已打开的 runtime，停止释放后为 null。Diretta/UPnP 不把保存的 ALSA 偏好当作其
activeMode。未开始播放仅在模式选择器反映已保存选择，不显示当前曲目的直通保证。

`processing` 是当前执行事实，不是保存配置的副本；direct 全部处理关闭。`adaptation`
实现时用可组合的值表示，以便同时表达重采样和量化，不要求互斥。不能把未知位深或设备
参数填成假定值。分析副本上的 FFT 转换不计入播放 processing。

Core 为当前输出和 phase 计算 `controls`。direct、Diretta、UPnP、切换中、状态未知时
DSP/音量/变速不可操作；稳定选中 processed 且无活动源的 idle 状态可允许编辑下一次播放
的 processed 配置。未知旧 Core 不返回能力时按不可操作/保证未知处理，不猜测是普通 ALSA。

模式选择器用于操作，实际路径信息留在按需打开的输出详情。播放主界面默认不新增状态
文字或徽标；如保留小图标，其语义以实际 path 为准，不拿模式偏好充当当前音频保证。

若采用直通图标，它只在 Core 的当前 generation/实际 path 与 integrity 同时表明 exact-pcm 或
native-dsd 时显示，并要求 ALSA activeMode=direct（Diretta 使用其独立 strict 事实）。
processed 的 integrity 永远是 not-exact，即使 EQ 全零、音量 100%、rate 相同；仅选择
`direct`、无损文件标签、设备为 `hw`、暂停前遗留状态，都不是充分条件。暂停且 runtime
仍有效可保留路径标识；stop、失败、释放、切换到其他输出或未知状态时清除旧曲标识。

Core 在同一份带 revision 的 snapshot 中提交模式、路径、保证与能力，Web 统一投影到所有
组件，不能逐字段拼出“直通徽标 + 可操作 DSP”的中间态。客户端丢弃旧 revision 事件；
断线重连先锁定控件并清空保证，取得完整 snapshot 后恢复。请求结果只能确认提交，不能
覆盖更新的 WS 状态。

### 9.3 模式切换事务

1. 用户在 ALSA 模式选择器明确选择目标；Web 显示“正在切换”，立即锁定样本处理入口，
   暂停使用原直通徽标。Core 发布同样的 preparing 状态，使其他客户端同步锁定。
2. Core 校验请求 revision、目标输出与源类型，保存源媒体位置、播放意图、processed 参数，
   作废旧 staging。DSD→processed 等确定性不支持在释放旧 runtime 前拒绝；拒绝后发布
   未变的实际路径和可操作性，不能保留待切换模式的假标识。
3. 准备新路径，停止旧 producer/writer，丢弃旧模式的设备缓冲，使用同一个 ALSA 后端重建。
   处理模式切到 direct 时先确认旧 DSP 输出不再滞留在 ALSA 缓冲；不能只翻 UI 开关。
4. 新 runtime 校验、预缓冲和 commit 均通过后，原子更新偏好与完整状态，递增 revision。
   旧 load/参数/事件不能在此后复活。失败不提交目标偏好；若旧输出已经释放则保持停止并
   清空 activeMode/path/integrity，不自动回到旧模式或默认设备。
5. direct→processed 使用已保存参数，按原播放意图恢复；processed→direct 为避免从
   软件衰减/静音直接变成满幅，统一在切换后保持暂停。选择器提前显示“切换后暂停，
   音量由外部设备调节”；用户正常点击 Play 继续，不需要另一套确认向导。

没有已加载源时只提交 Core 模式偏好并发布 idle 能力，不为了切换模式打开硬件或伪造
activeMode/直通徽标；下次 load 按该偏好实例化。processed 的 idle 参数修改只更新
Core 已保存配置，不创建一个无人消费的后台 DSP 线程。

同一设备上的模式切换也必须走此事务。进入 Diretta 等软件 gain 从衰减变 unity 的输出
切换遵循相同的暂停语义。stop/seek/快速重复切换可以取消过期事务；普通暂停/恢复不自动
切模式。staging/播放预备 key 包含输出、mode 与影响处理兼容性的版本，不能消费旧模式
的已处理预载。原字节歌曲缓存/物化文件仍按源共享，不因 mode 不同重复下载或复制文件。

### 9.4 现有 UI 的适应性改造

复用当前组件，调整数据来源与入口，不另做一套播放器页面。展示以低干扰为原则：

- 播放主界面默认不新增常驻链路状态文字，也不要求必须有状态标识。
- 若需要状态入口，复用现有输出按钮或一个小型静态图标，不增加整行说明、醒目徽章、
  闪烁动画或每次切歌的通知。不要新增“显示状态”设置来转移设计负担。
- 图标如有具体含义，提供简短 tooltip 和无障碍名称，例如“直通”；触屏点击可打开
  输出详情。图标不得暗示未取得的端到端验证。纯设备入口图标不代表 bit-perfect。
- 模式选择器仍清晰区分两种模式；PCM/DSD、源/设备格式、处理项与保证范围只在用户
  主动打开详情或说明时展示，不自动展开到播放区域。

各处行为如下：

| UI 位置                                      | direct / 直通输出                                                           | processed                                              | 切换中、断线或未知                                       |
| -------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| 输出选择器、播放设置                         | ALSA 提供“精确直通 / PCM 处理”选择；解释有损例外                            | 展示已确认处理模式与同一 HW 设备                       | 显示切换/连接状态，不把请求模式当成功                    |
| 工具栏软件音量与静音                         | 移除可操作音量条/静音；需要时在图标提示或设置内说明外部调节，不常驻解释文字 | 保留滑块、静音及实际软件音量                           | 禁用控件，不接受滚轮、按键或拖动提交                     |
| EQ/变速/变调快捷入口                         | 禁用并说明“切换到 PCM 处理模式后可用”，不提供可调参数                       | 保留现有入口及弹窗                                     | 锁定；已经打开的弹窗同步切为不可编辑                     |
| 播放设置的归一化、ReplayGain、fade、削波保护 | 隐藏可编辑区域，保留不可用说明；不显示已存开关为正在生效                    | 展示并绑定 Core 参数/生效状态                          | 锁定，失败后回读完整状态                                 |
| 播放器输出标识/详情                          | 默认不标；可选小图标仅在实际满足保证时出现，细节按需查看                    | 不标或仅用中性输出入口；不出现直通图标，处理项留在详情 | 清除旧保证图标；切换反馈限于用户操作位置，不常驻技术说明 |
| 音源音质选择、曲目 Hi-Res/无损标签           | 保持源质量含义，与输出链路分开展示                                          | 同左；无损源经 DSP 仍不能显示输出直通                  | 不用源标签推断输出状态                                   |
| 频谱                                         | PCM 可用，DSD 不可用；不当成 DSP 开关                                       | 观察处理后的 PCM                                       | 停止旧源频谱，待新时间线就绪                             |

具体落点：

- `src/core/player/directMode.ts`：改为消费 Core output 投影的统一模式/能力 helper；替换
  只靠 `isDirettaOutput()` 或 `isSampleProcessingUnavailableOutput(deviceId)` 判 DSP
  能力的逻辑。共享的设备 namespace helper 仍保留用于身份，不承担模式 authority。
- `src/web/OutputDeviceSelector.vue` 与 settings 的 `DeviceSelector.vue`：共用同一个模式
  选择组件/命令，ALSA 才显示两选项；Diretta/UPnP 显示各自固定行为，不出现可用 DSP 模式。
- `src/components/player/Toolbar.vue`：覆盖音量、静音、滚轮和 EQ/速度入口，移除把直通
  固定写成“Diretta Source Direct”的常驻展示，按上述规则省略状态或复用小图标，
  不替换为另一串更长的技术术语。
- `src/components/modals/EqualizerDialog.vue`、`SpeedDialog.vue`：能力失效时立即取消未提交
  的拖动/防抖请求并禁用控件；已打开弹窗显示不可用说明。不能关闭弹窗后又提交旧参数。
- `src/settings/categories/player.ts`、`DirectModeNotice.vue`：保留 DSP 设置，按能力隐藏/
  锁定和提示，展示保存与生效状态的区别；移除“休眠 EQ 配置阻止进入直通”的旧提示。
- `src/components/player/QualityControl.vue` 与音质详情：音源质量不与直通徽标共用判断；
  processed 播放 FLAC/Hi-Res 的场景作为专门验收用例。
- `src/core/player/index.ts`、settings 通用提交、快捷键/滚轮/媒体键：使用同一能力检查，
  不只修改可见按钮；中英文文案、移动端/全屏和多客户端视图保持一致。

### 9.5 命令防护与保存行为

保留 DSP/软件音量的现有 HTTP/WS、插件及 N-API 能力，迁移到 processed producer。
任何样本处理修改都先检查当前输出、模式、phase 和 revision；direct 下无论用户把音量
设为 1 还是 0，命令都明确返回 `processing_unavailable`，不改保存参数、不偷偷切模式。
直通下也不允许通过通用 settings API、重置 EQ 或键盘快捷键绕过约束。

新版前端的修改请求携带所观察的 output revision；过期请求返回冲突并回读 snapshot。
插件 host 为命令绑定接收时的输出 revision，在实际执行时再次检查。HTTP/WS 旧客户端
缺少必要 revision 时给出明确升级/刷新错误，不静默执行无法判定所属模式的样本修改。
Core/native 最后一道校验独立于 Web；不能仅依赖按钮 disabled。

在 processed 中，参数先由 Core/native 接受并形成版本化快照，再提交配置/状态；失败
不能只把勾选留在 UI。直通/远端状态的 `volume=1`、`speed=1` 表示本地无增益/变速，
不覆盖保存的 processed 参数，也不代表 DAC 实际音量。processed 状态返回实际生效值。

删除的仅为默认设备/watcher 和旧输出专属 N-API 接口；保留 DSP setter/getter 并修改实现。
同步更新生成类型、协议版本/能力、错误映射和插件文档；插件失败进入诊断，不吞掉异常。

### 9.6 升级行为

使用现有迁移和部署备份流程，保留 DSP 配置、软件音量、EQ 预设和无关设置。已有安装缺少
模式字段时，将 ALSA 偏好迁移为 processed，保持原有音量/音效意图；不能因为升级默认到
direct 导致软件音量失效。已有 Diretta/UPnP 选择不改变，只初始化未启用的 ALSA 偏好。

新安装默认 direct；尚未启用的 processed 配置沿用现有默认值。旧 limiter 行为由明确
启用的 processed 削波保护承接。原有有效 HW ID 沿用，默认设备/歧义名字进入未选择状态。
迁移后 Core 初始化按模式构造处理路径，不先把 saved DSP 应用到直通再尝试关掉。

切到 direct 不删除或重置 processed 配置；返回 processed 可恢复原设置。恢复会话、
应用重启、刷新浏览器、重连与输出切换都从 Core 读取同一模式和配置，没有浏览器私有的
第二份模式状态。模式失败/未完成不能被持久化为成功。

### 9.7 FFT

保留 PCM 频谱为只读旁路：direct 分析解码样本副本，processed 分析软件音量/效果处理
后的 PCM。独立线程进行分析用 float 转换、降采样和 FFT；分析队列满则丢分析帧，不阻塞
输出，不回写样本。时间戳对应实际播放位置，处理时延和变速也需映射，不能提前显示预载。

只在可见 Web Control 请求时运行，所有客户端隐藏/断开时停止；一个客户端关闭不影响
其他可见订阅。DSD 不为频谱增加 DSD-to-PCM，Diretta 保持当前频谱不可用行为。
FFT 入口不受样本 DSP 锁误禁，是否可用由 Core `canUseFft` 决定。

## 10. 文件级实施工作与依赖

以下是完成同一个目标的依赖顺序，不是发布批次，也不把后面的条目留作可选补丁。

| 工作                     | 主要文件                                                                                                              | 完成要求                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 提取独立探测/PCM 解码    | `decoder.rs`、`direct_pcm.rs`、新增 `media_probe.rs`/`pcm_decode.rs`                                                  | 探测不依赖播放/DSP；整数 strict 与有损适配边界明确                               |
| 迁移 PCM DSP             | 新增 `pcm_processing.rs`、`equalizer.rs`、`loudness.rs`、`tempo.rs` 与原 resampler/limiter                            | 现有功能在 processed 生效，direct 不构造处理图；参数、延迟、尾部和时间映射可核验 |
| 修正 DSD reader 边界     | `direct_dsd.rs`、`diretta/`                                                                                           | 共享逻辑序列与 transport 分组解耦；Diretta 样本/位序证据回归通过                 |
| 实现 ALSA 后端           | 新增 `alsa/`、Cargo manifests/lock                                                                                    | 精确参数、整数打包、有损适配、Native DSD、短写与可取消 writer 全部可用           |
| 合并 native 生命周期     | `playback.rs`、`direct_runtime.rs`、`player/*`、N-API `bindings/player.rs`                                            | 唯一 runtime；进度/drain/boundary/取消语义通过测试                               |
| 接入 Core 输入与失败策略 | `playerLoad.ts`、`playbackPreloader.ts`、`directGapless.ts`、`playbackSession.ts`、`device.ts`、`corePlayerEvents.ts` | 本地/在线/CUE/SACD/输出切换一致；缓存引用安全                                    |
| 协议与迁移               | `shared/types/*`、`shared/utils/outputDevice.ts`、Core routes/WS/plugins/store                                        | 模式事务、参数保存和能力同源；旧配置迁移 processed，直通拒绝 DSP 请求            |
| Web 与旁路 FFT           | `src/core/player/*`、输出选择器、Toolbar、EQ/Speed 弹窗、播放设置、质量详情、快捷操作                                 | 按第 9.4 节逐项适配，控件与徽标互斥，多个客户端状态一致                          |
| 删除旧实现及专属测试     | 第 2 节文件、native re-export、Cargo/features                                                                         | 删除 CPAL/旧线程编排/隐式处理，保留并测试迁移后的 DSP 算法                       |
| 构建与文档同步           | native build/staging、native flavor 测试、AGENTS/native/部署/硬件文档及中英文对应内容                                 | 普通构建无需 SDK；Diretta SDK provenance 不变；文档不声称尚未取得的实机证据      |

删除测试时仅删除已移除产品行为的断言；原本验证取消、错误分类、输出互斥、分轨和 provider
行为的测试要迁移到新实现。当前一些测试匹配 CPAL feature 和源代码字符串，需替换为新
依赖约束/行为测试，不能为了让旧文本测试通过留下假文件和死代码。

## 11. 验证与验收

### 11.1 软件样本证据

- PCM 使用零、正负满幅、最低有效位、跨字节边界、随机样本、多声道独特序列，覆盖
  8/16/20/24/32 有效位及各输出打包格式。归一到同一有效位表示后逐样本严格相等。
- 编码器/解码器样本比对覆盖 WAV/AIFF、FLAC、ALAC、APE、WavPack 的 packed/planar，
  包括首尾、seek、CUE、gapless。测试预期数据不能仅由被测 packer 的逆函数生成。
- 有损覆盖 MP3/AAC/Vorbis/Opus 的真实可解码 fixture、delay/padding、短文件、满幅外值；
  以当前固定 FFmpeg 解码结果与独立量化基准核验，不要求与不存在的原始录音相等。
- Native DSD 用每声道不同的非对称位图，覆盖 DSF/DFF/SACD/DST、位序、字节序、U8/U16/U32、
  分组尾部、seek 和 CUE；统一为逻辑位序列逐位比较。
- fake writer 注入连续短写、EAGAIN/EINTR、XRUN、suspend、设备掉线、drain 卡住与取消；
  验证 frame 无重复/遗漏、EOF 只报一次、不会发送人为静音、停止能唤醒线程。
- direct 精确源不支持时不会进入有损 adapter 或 processed；有损音源不会触发整数精确标记；Diretta 和
  UPnP strict reader 不受 ALSA 有损支持影响。
- 验证 pause fallback、多个极短曲目边界、变格式、快速 load/seek/stop、过期 callback、
  current/staged 文件 pin、空间不足与取消下载，不发生旧源复活和重叠设备持有。

### 11.2 双模式与 UI 验收

- 同一 HW 上测试 direct↔processed、快速重复切换、切换中 stop/seek、失败与重连；只有
  一个活动 PCM handle，旧模式样本不进入新模式，旧 revision 不覆盖新状态。
- direct 整数 PCM/DSD 满足精确样本测试；direct 有损不显示直通图标；processed
  无论是否启用效果均不显示直通，Native DSD 在 processed 下明确拒绝。
- 分别验证 EQ、归一化/ReplayGain、软件音量/静音、fade、变速/变调、削波保护的实际
  输出效果和参数版本；确认没有双重增益、漏做保护或无法旁路的隐藏 limiter。
- 验证 processed 设备 rate 适配、DSP 延迟、tempo 尾部、变速过程中 seek/媒体时间、
  gapless 曲目边界和统计；direct 不能调用处理 resampler。
- 将第 9.4 节矩阵变为组件/集成测试：直通时所有入口不可操作，已打开弹窗/拖动/防抖
  请求失效；处理时功能可用且没有直通徽标。processed 播放 Hi-Res FLAC 且效果全关是
  必测场景，防止用源质量或参数全零推断 bit-perfect。
- 检查主播放器、工具栏、全屏和移动端没有新增常驻技术状态长文案；无图标也是合法
  展示。如采用图标，检查简短 tooltip、无障碍名称、触屏详情入口和状态语义，不能每曲
  自动弹出链路说明或仅靠颜色区分保证。
- 使用 HTTP、WS、插件、通用 settings 直接修改验证 Core/native 拒绝能力，而非只测
  disabled 属性；过期 revision、缺字段、旧客户端和错误响应均不得更改休眠参数。
- 两个 Web Control 同时打开不同弹窗，一端切模式，另一端锁定并丢弃旧提交；验证隐藏、
  断线、重新连接、HTTP/WS 乱序、全屏与移动端，不出现“可用 DSP + 精确直通”组合。
- 配置迁移保留旧音量/EQ/音效并选 processed；direct↔processed 保存与恢复值正确，
  切到直通保持暂停，重启不会错误恢复另一模式的音量或标识。

### 11.3 集成与构建

执行开发指南完整检查：`pnpm typecheck`、`pnpm test`、`pnpm lint`、`pnpm build`、
`pnpm docs:build`、`cargo check --workspace`、`cargo test --workspace`、`git diff --check`。
另外分别验证无 SDK 的普通构建与有 SDK 的 Diretta 构建、release artifact smoke 和退出。

依赖树不再包含 CPAL、rustysynth 等已无消费者的依赖。保留 processed 仍使用的
signalsmith-stretch，以及解码/扫描/HTTP/分析需要的 FFmpeg、rustfft；不能以清理旧
后端为由删除 DSP 产品功能或仍需的依赖。
正式 artifact 继续禁止 PipeWire/PulseAudio 动态依赖，不能把 `alsa-lib` 的可配置插件入口
误当成“没有链接桌面声音库就一定硬件直通”。

回归覆盖 ALSA↔Diretta↔UPnP、Core auto-next、CUE/SACD、歌曲缓存、网易/Qobuz/TIDAL、
ListenBrainz、Web 多客户端与插件错误。旧日志中的 CPAL/普通路径术语同步更新。

### 11.4 实机证据

完整记录模式、源 hash、构建 commit/artifact hash、内核/驱动、DAC、HW ID、协商 format/rate/
channels/sbits、XRUN/中断次数和测试结果。覆盖设备实际支持的常见 PCM rate/位深/声道，
以及目标设备支持的最高 PCM/Native DSD rate；不预先把 Diretta 的 768 kHz/DSD512 实绩
当成 ALSA 实绩。

direct PCM 使用数字回录或设备 bit-test；DSD 使用能验证逻辑位序列的链路。对齐固定延迟后比较
有效数据，另外检测遗漏、重复和切歌边界，不能用简单 hash 忽略尾帧丢失。
`hw_params`、DAC 面板、loopback 和模拟录音分别只能证明其覆盖的层次，不能替代最终设备
的 bitstream 证据。缺少可验证设备时记为 BLOCKED，不把“听起来正常”记为 bit-perfect。

实机还需覆盖短曲尾部排空、暂停/恢复、快速 seek、同格式无缝、变格式锁定、PCM/DSD 混播、
设备占用/拔插、systemd stop/restart/SIGTERM 与过夜循环。检查首尾截断、爆音、错误恢复、
统计边界、内存/线程/FD 与临时缓存趋势。direct 禁用 fade，不能用软件包络掩盖硬件启停
问题；processed 验证效果开启/关闭、软件静音和模式切换，不能以 bit-test 不通过误报为
直通缺陷。有问题的设备组合如实记录并定位配置/驱动原因。

## 12. 完成条件

本方案只有在以下条件全部满足时才完成：

- 一个 ALSA HW 后端支持 direct/processed，始终只有一个活动输出；精确整数 PCM、
  Native DSD、有损/浮点播放及原有 PCM DSP 功能均通过所属模式的软件验证。
- 本地/在线、CUE/SACD、预加载、媒体时间、精确边界、取消、启停/seek、模式与输出切换可用。
- Core/native 强制模式约束，HTTP/WS/settings/插件没有绕过途径；模式、能力、实际路径
  和徽标由同一权威 snapshot 驱动，直通不能操作 DSP，处理模式绝不显示精确直通。
- 现有 UI 按第 9.4 节逐项改造，已打开弹窗、快捷操作、移动/全屏、多客户端与重连都覆盖；
  保留 processed 用户配置，升级和切换不会意外让软件衰减变为满幅自动播放。
- CPAL、旧输出队列/线程编排、隐式全路径 limiter、静音填充与无消费者模块已清理；
  DSP 算法/必要依赖、元数据、reader、FFT 和 UPnP 提取保留且有明确模式/消费者。
- 普通与 Diretta 构建通过，共享改造不破坏 Diretta strict 行为，也不将 ALSA 的 DSP
  开关应用于 Diretta/UPnP。
- direct 取得独立 ALSA bitstream 证据，两模式完成长期/生命周期/切换验收；已有普通
  ALSA 播放记录只作历史基线，不继承为新路径的验收结果。

不以发布时限缩减这些条件，也不以永久保留旧后端替代完成新实现。实施中若发现本方案与
已接受产品要求冲突，应修订设计和 Roadmap；保留 DSP 功能不意味着保留旧 CPAL 播放器。
