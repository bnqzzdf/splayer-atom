# 2026-09-23 ALSA 缺口修复与 FC4 局部复测

本次修复源码提交为 `123cbdac`（曲尾解码失败分类）、`37aee7a1`（Processed tempo、
limiter 与曲终 drain）、`9e76bfa2`（队列/缓冲池界限）和 `53284360`（暂停 drain 取消）。
FC4 运行验证使用包含上述四项修复的本地 release native 模块；构建时仅有文档及注释
未提交。这不是 clean Core 安装包，也不替代最终设备 bitstream 验收。

## 修复与软件验证

- 已知解码失败即使发生在曲尾 3 秒内也上报 `SourceError`；仅正常 EOF 上报 `Ended`。
- Signalsmith Stretch 的预热输出从播放流裁剪，在 EOF 用输入延迟对应的静音推进并取回
  有效尾部。输出帧数按累计变速比取整，DSP 块把实际可播放的输出帧映射回源样本；
  切回 bypass 先排空旧效果。staged 下一首重置 limiter 历史。
- Processed 自然 EOF drain 时，硬件吃完最后一帧后进入 `XRUN/Setup` 或返回 `EPIPE`
  视为终结排空；暂停 drain 仍按错误处理。
- Processed 解码/DSP 队列按最多 4096 frame 单块拆分，限制空闲 buffer 的块数和容量；
  超大块拆分后保持总源样本数和首块曲目边界。三种 ALSA 模式在无硬件暂停时均用 runtime
  取消标志中断 drain，主动关闭不再标为 Direct 输出故障。该 fallback 分支尚无无硬件暂停
  设备实测。
- `CARGO_PROFILE_TEST_DEBUG=0 cargo test -p audio-engine-core --lib -q`：180 项通过。
  带 `--features diretta`：175 项通过；`cargo check -p audio-engine --features diretta`
  通过。`cargo fmt --all --check` 与 `git diff --check` 通过。
- `DIRETTA_SDK_ROOT=/home/bnqzzdf/code/DirettaHostSDK_150 DIRETTA_CPU_VARIANT=v3
  cargo build -p audio-engine --release --features diretta` 通过。本地模块
  `target/release/libaudio_engine.so` SHA256 为
  `af101c5ee61032196ec1f6c3f7d9904b2d58a90f76b744aba2d45b91fbf42dee`。

## FC4 观察

Core 原状态为 FC4 Direct 单曲暂停，位置 2961 ms。测试先用 Core API 停止旧输出，再用临时
native 模块打开 `alsa:hw:CARD=FC4,DEV=0`。0.6 秒、44.1 kHz、16-bit stereo WAV
在首尾各有 0.1 秒正弦信号。最初本地构建在开启 +5 半音时出现 `outputFailed`，native 日志
指向等待 ALSA PCM 事件失败；修复 Processed 自然曲终 drain 后复测如下：

- +5 半音原速：只收到一次 `ended`，位置到 0.6 秒，无 `sourceError/outputFailed`。
- +5 半音、1.25×：同样只收到一次 `ended`，位置到 0.6 秒，无 `sourceError/outputFailed`。
- 同一修复模块对本地 FLAC 执行 Processed seek 到 30 秒后仍为 `playing/processed-pcm`，
  随后切 Direct 可播放，路径为 `exact-pcm`。
- +5 半音、1.25× 播放同一本地 FLAC，seek 到 30 秒后仍为 `playing/processed-pcm`，
  随后观察位置 30.58 秒；切回 1×/0 半音后 Direct 仍可播放。
- 测试退出释放临时输出后，Core 恢复 FC4 Direct 单曲暂停、2961 ms、`exact-pcm`。

短曲信号的首尾非零和总输出帧数由 DSP 单测验证；本次 FC4 记录的是事件、进度与输出
可用性，没有数字回录，不能据此宣称 DAC 端尾音逐样本正确。ALSA writer loop 收口、
上游单次解码/处理临时分配的完整字节预算、完整参数版本、无硬件暂停设备的取消实测、
clean artifact 全矩阵和最终设备证据仍未完成。
