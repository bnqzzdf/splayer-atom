# Diretta Core 排障

> 最后更新：2026-09-28

本页只描述当前正式 Atom Core 的 Diretta Source Direct 路径：Node Core 负责业务与音源 materialization，`audio-engine.node` 调用 `audio-engine-core` 的 strict Direct runtime，`diretta-sys` 是唯一 Diretta Host SDK FFI。旧 Pure Rust Axum Headless、普通 `f32` Diretta output backend 与旧 push FFI 均已退役。

## 运行边界

```text
Node Core
  -> audio-engine.node
  -> audio-engine-core::direct_runtime
       -> direct_pcm / direct_dsd
       -> diretta
       -> diretta-sys
       -> Diretta Host SDK / Target
```

Source Direct 必须保持源采样率、声道、PCM 有效位与 Native DSD one-bit sequence。Target 不支持精确格式时明确失败，不做重采样、软件音量、EQ、normalization、fade、tempo/pitch、DoP 或 DSD-to-PCM fallback。

## SDK 与构建

正式 Diretta build 通过 `DIRETTA_SDK_ROOT` 提供 SDK。Core 构建脚本会在存在该变量时显式启用 Cargo `diretta` feature；没有 SDK 时 `diretta-sys` 不进入依赖图。SDK release gate 由正式 build/release 脚本和 `docs/build-flavors.md` 管理。

不要恢复 `atom_diretta` crate-local cfg，不要在 `build.rs` 猜测用户 home 下的 SDK，也不要恢复第二套 C++ bridge。

## Discovery 成功但连接失败

Diretta discovery 成功只说明能够发现 Target，不证明 Host 进程具备完成连接/实时发送所需的权限。Linux 真实连接与播放验收按项目规则使用 root Host process；用户态 discovery timeout 或连接失败不能直接诊断为 Target 故障。

若出现 discovery/connection 歧义：

1. 确认 Target 没有被另一 Host 独占。
2. 用正式 Core artifact 和同一 SDK provenance 重试。
3. 查看 Core 日志中的 exact-format negotiation/error；不通过修改采样率或进入普通 DSP path 规避。
4. 只有确认 Target 独占与 Host 权限后，才考虑 Target reset/power-cycle。

## 实时回调约束

`diretta-sys/src/bridge.cpp` 的 SDK pull callback 只借用 Direct ring 已准备好的 payload。实时回调中禁止 discovery、格式协商、日志、mutex、动态分配和可避免的 sample copy。SDK release callback 后 Direct ring 才允许复用 in-flight slot。

Diretta Source Direct 下，PCM Direct 仅接受 strict integer PCM storage（S16/S32；24-bit source 可作为保留有效位的 S32 transport slot），float PCM 明确拒绝；ALSA Direct 路径则接受 Float32（`alsa/format.rs` 的 `pack_direct_pcm`、`alsa/direct_pcm.rs` 的零拷贝 transport）。DSF/DFF 只允许为 wire bit-order 做逐字节 bit reversal，并必须保持逻辑 DSD bit sequence 不变。

## 验收

软件门禁至少包括：

- `cargo test -p audio-engine-core`
- `cargo test -p audio-engine --no-run`
- strict Direct fixtures：PCM16/24/32、FLAC/ALAC/WavPack/APE、DSF/DFF、seek、gapless、underrun
- Direct implementation 静态断言不得出现 `f32`、resampler、EQ、normalization 等 sample-altering pipeline
- 无 SDK Core native build 不得链接/编译 Diretta SDK
- 带 SDK Core artifact 必须通过真实 Target 的 PCM 与 Native DSD exact-format hardware gate

硬件测试失败时保留错误语义并修正真实生命周期/权限/协议问题；不要增加 float fallback、silent retry 或第二套 Diretta implementation。
