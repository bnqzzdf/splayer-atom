# 2026-09-23 ALSA native 运行态改动复核

这是当前源码工作树的局部构建与 FC4 smoke，不是 clean Core 包或最终设备验收。
与 [修复包复验](./alsa-acceptance-2026-09-23.md) 使用的已安装 `3e420f78` 包分开记录。

- 使用 Diretta SDK 150、CPU v3 执行 `cargo build -p audio-engine --release --features diretta`。
  生成的 `target/release/libaudio_engine.so` SHA256 为
  `f9da8cda20fa75e40ce28dc0e15e8479e520a507343549d1d2c8e694f77989a1`。
  将该模块复制为临时 `.node`，Node 加载及设备枚举成功。构建时工作树包含未提交源码，
  因此该 hash 仅标识本次本地模块，不标识发布包。
- 普通 `audio-engine-core` 172 项单元测试通过；带 Diretta feature 的 167 项通过。
  `cargo check -p audio-engine --features diretta` 通过。
- Core 原为 FC4 Direct、单曲暂停于 2961 ms。先用 Core API 停止旧输出，再用上述
  native 模块单独打开同一 FC4 与本地 44.1 kHz / 16-bit stereo FLAC。
  Processed 播放后 seek 到 30 s，状态继续为 playing、`processed-pcm`，随后观察位置
  30.45 s；停止并切换 Direct 后播放，状态 playing、路径 `exact-pcm`。
- 测试退出释放 native 输出，再通过 Core API 恢复 FC4 Direct、单曲暂停，位置 2961 ms、
  路径 `exact-pcm`。未替换已安装 Core 包。

本轮覆盖新运行态的 Processed seek 与 Direct 基础播放；不覆盖长播、完整模式/格式矩阵、
最终数字输出或完整 ALSA 方案完成条件。
