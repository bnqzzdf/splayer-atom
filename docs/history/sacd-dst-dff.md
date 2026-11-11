# SACD DST 直通 DFF 方案

> 最后更新：2026-11-11

> 状态：已实现，并通过 `.137` Atom → `satld` UPnP → `.175` Diretta Target 真机验收。
> 目标是把 UPnP 播放 SACD DST 轨时的“离线 DST→DSF”改为“直接封装 DST 压缩 DFF”；
> 本地 ALSA/Diretta 路径保持解码，不做 DST 直通。

## 背景

当前 UPnP 播放 SACD 虚拟轨时，`extract_sacd_track_to_dsf` 会把整条轨道逐帧解码，
再写成完整 DSF。DST 解码和 DSF 重排是主要 CPU 成本，70 分钟 SACD 还会产生 2–3 GB 临时文件。

TinySPlayer 的 `sacd/source.rs` 采用另一条路径：按 SACD 扇区组装原始 DST 帧，
直接写入 DSDIFF（`CMPR=DST`、`DSTF` 帧、`FRTE` 帧数），不解码；
其 remote output 以 `audio/x-dff` 提供给 Renderer。

## 边界

- **UPnP**：Renderer 自行解码 DST，可以直通 DST-DFF。收益最大。
- **本地 PCM**：当前 `SacdDsfStream` 懒解码成 DSD，DFF 直通不能省掉 DST 解码。
- **ALSA Direct / Diretta**：DAC 不识别 DST，必须解成原始 DSD 才能输出。
- 因此本方案只改 UPnP；本地路径保持现状。

## 设计

```text
SACD ISO
  → SacdTrackReader(raw frame)
  → 原始 DST 帧
  → DSDIFF writer (CMPR=DST / DSTF / FRTE)
  → 临时 .dff
  → UPnP Renderer 拉取 audio/x-dff
```

### Rust

- `native/audio-engine-core/src/sacd/stream.rs`
  - 增加 raw frame 模式与 `next_raw_frame()`；
  - raw 模式不创建 `DstDecoder`，只做扇区解析、帧组装和边界校验；
  - 现有 `read_interleaved_dsd()` 的解码路径保持不变。
- `native/audio-engine-core/src/sacd/dsdiff.rs`
  - 新增 DSDIFF writer：64-bit BE chunk size、奇数 padding、`FRM8`/`FVER`/`PROP`/`FS`/`CHNL`/`CMPR`；
  - DST 写 `DST ` + `DSTF` + `FRTE`；非 DST 写 `DSD ` chunk；
  - 流式写临时文件，回填 form/payload size，内存 O(1)。
- `native/audio-engine-core/src/media_extract.rs`
  - 新增 `extract_sacd_track_to_dsdiff`；
  - 保持 `extract_sacd_track_to_dsf` 作为兼容回退。

### NAPI / Core

- `extract_sacd_dff` NAPI。
- `extractUpnpSacdDff`，输出 `.dff`，MIME `audio/x-dff`。
- 生成 DST-DFF 时跳过 `probeUpnpMediaQuality`：现有 `DffReader` 只识别 `DSD ` chunk，
  不识别 `DST `+`DSTF`；使用 canonical Track quality 或提取结果。
- 设置 `player.sacdUpnpFormat`：`dff`（默认，DST 直通）/ `dsf`（兼容转码）。

## 验收门禁

- Rust 单测：raw frame 与输入 DST 帧逐字节一致；DFF chunk/尺寸/帧数正确；不解码。
- `cargo test --workspace`、`cargo clippy --workspace --all-targets`。
- `pnpm typecheck`、`pnpm lint`、`pnpm test`。
- Debian 11 容器构建：glibc ≤ 2.31、runtime metadata、native addon load、artifact smoke。
- 真机：真实 SACD ISO + 支持 DST 的 UPnP Renderer，验证播放、暂停、seek、切歌、临时文件清理；
  不支持 DST 时切 `dsf` 回退。

## 真机验收记录（2026-11-11）

### 产物

- 文件：`splayer-atom-core-1.2.0-e587aa55-20261111-062549-diretta-v4-bundled-linux-x64-debian11-with-diretta-v4.tar.gz`
- SHA256：`2369c67bb051fe3c4e25f8ef494f133ea0270d34fcde0f8a872aca9b8741c504`
- `atomCommit=e587aa5562b2c0088cf0f1be927e48b8d44bd480`、`sourceDirty=false`
- runtime：Node `24.22.2` bundled；Diretta `true`、SDK `148`、CPU 变体 `v4`
- glibc：`audio-engine.node` / `streaming-api.node` 最高 `GLIBC_2.30`，`better-sqlite3` `GLIBC_2.29`

### 链路

```text
.137 GentooPlayer x86
  → Atom Core 1.2.0 + commit e587aa55，独立端口 14559
  → UPnP Renderer GP-137 / satld 1.7.44 (b4f134e9)
  → Diretta Target TargetApp_480A / MB30P
  → .175（MAC e8:51:9e:53:35:28）
```

`.175` 的 MAC 与 satld 的 `fe80::ea51:9eff:fe53:3528` 一致，确认是真机 Target。

### 素材

- `Come Away With Me-SACD-R/...iso`：14 轨，`sacd_dst`，2.8224 MHz / 2ch。
- `UEHARA RENA - Emergence-SACD/...iso`：14 轨，`sacd_dsd`（未压缩 DSD），2.8224 MHz / 2ch。

### 结果

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| DST 轨 → DFF 直通 | PASS | 96 ms；user CPU 20 ms；sys CPU 76 ms；`60,279,562` B |
| DST 轨 → DSF 兼容回退 | PASS | 28,278 ms；user CPU 27,985 ms；`131,227,740` B |
| 未压缩 DSD → DFF | PASS | `214,032,118` B；satld `fmt=dsd ext=dff` |
| 播放/暂停/恢复 | PASS | Core `state=playing/paused`，位置推进 |
| 两首 DST 队列 next | PASS | 从 Track01 切到 Track02，旧 DFF 替换为新 DFF |
| 临时文件清理 | PASS | stop 后 `splayer-atom-upnp-generated` 为空 |
| DST-DFF seek | BLOCKED（外部限制） | satld 返回 `UPnPError 710 Seek mode not supported`；Core 返回 400 |
| DSF 回退 seek | PASS | seek 到 60 s 后 Core 位置 61,000 ms |

satld `STATUS` 在 DST 与未压缩 DSD 播放时均为：

```text
owner=upnp active=diretta fmt=dsd rate=2822400 bits=32 ch=2 ext=dff
sinktarget=TargetApp_480A sinkout=MB30P
```

`dropped=0`；首启观察到一个 `underrun=1`，后续播放/切歌未再出现，未影响起播与进度。

### 门禁

- `pnpm typecheck`、`pnpm lint`、`pnpm test`：PASS（36 个 Web 测试文件、166 tests）。
- `cargo test --workspace`：PASS。
- `cargo clippy --workspace --all-targets`（Rust 1.98.0）：PASS；仅有既有 `large_enum_variant` warning。
- Debian 11 容器构建：PASS，含 native addon load、Core artifact smoke、glibc/Diretta 元数据检查。
- `pnpm docs:build`：PASS；`pnpm docs:stamp:check` 仍报告既有 README 时间戳待刷新，与本次改动无关。

## 风险

- Renderer 对 DST-DFF 的支持不统一；默认 DFF，保留 DSF 回退。
- 本地 ALSA/Diretta 仍解码 DST，本方案不降低其 CPU。
- Atom 当前仅支持双声道 SACD。
- 生成的 DST-DFF 不应交给 `DffReader` 做本地播放或质量探测。
