# 2026-09-22 ALSA 与发布包实测

> 最后更新：2026-09-23

本记录只对应下述 `cecee166` 包。之后的 `c3e135ab` 已在软件中修复 Processed PCM
seek 和重启后直接 Play；本记录中的 FAIL 是该旧包的实测结果，修复包的硬件复验仍见
[Roadmap](./atom-roadmap.md)。

环境：Linux 7.0.0-31-generic x86-64，HiBy FC4，Diretta DX5 II，Node 24.18.0。
通过已安装 Core 的 HTTP API 操作真实输出；测试结束恢复原队列、FC4、Direct 模式，
保持停止，ALSA handle 已关闭。FC4 USB 授权已恢复，临时加载的 usbmon 已卸载。

## 发布包身份与 smoke

- 源码提交：`cecee166b5c3014d0221a2573965314dfda79d98`，包记录 `sourceDirty=false`。
- 包：`splayer-atom-core-1.1.0-20260922-diretta-v3-bundled-linux-x64.tar.gz`。
- SHA256：`b9ec85e6f9d4fac0936caf23f6e0062422b7852933f57728dd5bba7524050a1d`。
- 安装目录中对应的 220 个非 data 文件与归档内容逐一比对，差异为 0。
- 在临时目录解包，运行现有 `check-core-artifact.ts` 的检查逻辑；临时副本仅调整归档路径
  和模块解析路径，检查逻辑不变。native 加载、HTTP、Web、session、library、cache、
  WebSocket 多客户端/断开重连、SIGTERM 及同 data 重启均通过。

## ALSA USB 提交数据比较

使用 usbmon 二进制接口与 tcpdump，仅捕获 FC4 的音频 ISO OUT endpoint，
不捕获键盘/HID 或其它 USB 设备载荷。先开始抓取，再通过 Core 从曲首播放，约 8 秒后停止。
解析每个 URB 的 ISO descriptor，按 offset/length 拼接有效音频载荷。

PCM 参考值由独立 `ffmpeg` 解码为 `s16le`；DSD 参考值直接读取 DSF，按文件声明的
channel block 解交错、将 LSB-first 字节转换为 MSB-first，并按 `DSD_U32_BE` 的
每声道四字节槽交错。没有使用 Atom 打包函数生成参考值。

| 项目                     | PCM                             | Native DSD                                 |
| ------------------------ | ------------------------------- | ------------------------------------------ |
| 音源                     | Brahms / Haydn Variations，FLAC | Accardo / Beethoven Op.40，DSF             |
| 源格式                   | 44100 Hz / 16-bit / 2 channels  | DSD64 / 2822400 bit/s/channel / 2 channels |
| HW 格式                  | `S16_LE`，44100 frame/s         | `DSD_U32_BE`，88200 frame/s，`DOP=0`       |
| 完整抓取并比较的提交载荷 | 1,414,748 字节                  | 5,658,992 字节                             |
| 结果                     | 从源偏移 0 开始，全部字节一致   | 从源偏移 0 开始，全部字节一致              |
| 截断包 / 抓取丢包        | 0 / 0                           | 0 / 0                                      |

PCM 源 SHA256：`5f41f25289019e935fe84663b3fa2a835729f8cfefb7114512e3556f1895e9a8`。
DSD 源 SHA256：`7925b903b625fa4719fe02c1bc69d412bbe596f67fd0181d066affea7e2c0acc`。
PCM 载荷 SHA256：`0c71647fd4fd714360e1057af3601991b99a8a6ffeabad740855e110d347ca80`。
DSD 载荷 SHA256：`d752bd949ef9d7c6f25ec1148c1dfbed1078b899446d9d43f44b375f53e03dd3`。

正常完成的 URB 分别为 10414 / 9612 个；显式停止时各有 12 个在途 URB 被取消
（`-104`）。比较对象是全部捕获的提交载荷，包括停止时可能尚未播放的提交数据。
这验证了本次连续片段在 USB 驱动提交层没有样本变化、遗漏或重复；没有验证整首 EOF 尾帧、
DAC 内部处理或最终数字输出。[内核 usbmon 文档](https://docs.kernel.org/usb/usbmon.html)
明确说明该接口观察的是设备驱动提交给 Host Controller Driver 的请求，不保证等同物理总线事务。
因此将其记为独立的软件输出数据证据，最终设备 bit-test/数字回录仍保留为单独验收。

## 生命周期与输出回归

| 检查                                       | 结果    | 观察                                                                                    |
| ------------------------------------------ | ------- | --------------------------------------------------------------------------------------- |
| 播放中 systemd restart                     | PASS    | 旧 PID 退出，新 PID 启动，队列保留                                                      |
| 重启后直接 POST `/api/play`                | FAIL    | HTTP 成功，但仍为 idle、位置为 0；显式选曲可正常播放                                    |
| 播放中 SIGTERM                             | PASS    | `Result=success`、`ExecMainStatus=0`，声卡状态 closed                                   |
| systemd start 后显式选曲                   | PASS    | PCM 播放及进度正常                                                                      |
| FC4 播放中断开、重新上线                   | PASS    | 仅对 FC4 USB device 执行 authorized 0→1；断开后暂停且不换设备，重新上线后显式 Play 恢复 |
| ALSA→Diretta PCM                           | PASS    | DX5 II 的 exact-pcm 进度推进；FC4 handle 关闭                                           |
| Diretta Native DSD64                       | PASS    | native-dsd 路径及进度推进                                                               |
| Diretta→ALSA DSD64                         | PASS    | FC4 重新协商 `DSD_U32_BE` 并持续播放                                                    |
| UPnP 实机                                  | BLOCKED | 重复 discovery 未发现 MediaRenderer，未以模拟设备代替                                   |
| UPnP / 输出切换 / Direct shutdown 软件回归 | PASS    | 31 项现有测试通过；不作为 UPnP 实机证据                                                 |

首次尝试只解绑 FC4 控制 interface，未完整重建设备的 PCM endpoint；该步骤不作为产品
重连失败证据。恢复完整 USB device 后，重新执行上述播放中断开/重连及输出往返测试，均通过。
Diretta 本次只复验常用 PCM 与 DSD64 的运行态；未重新验证最高 768 kHz/DSD512、
Target 数字输出或在线物化链路。此前实机证据仍按原记录保留。

## 本次包未关闭的项目

- Processed PCM seek：先前实测的 HTTP 400 仍未修复，见硬件清单中的复现记录。
- 重启后的 `/api/play`：`playbackSession.ts` 只在 stopped 或未选索引时加载队列；
  恢复后的 idle 且 index 有效会直接调用无已加载源的 native play，与实测现象一致。
- 统一 runtime / producer-writer 职责：代码审计仍不符合原实施设计。
  `player/mod.rs` 保留独立 `playback`、`decoder_thread`、`direct_playback`；
  `alsa/processed_pcm.rs::run_writer` 仍执行 `packed.resize`、最终 gain/limiter 与 packing。
  播放测试通过不能替代这些结构性改动。
- 完整发布验收仍未通过：上述功能失败、UPnP 设备缺席、最终设备逐位验证及本次未重跑的
  最高格式/在线/升级回滚项目不能用基础 artifact smoke 代替。

本次只执行验证和更新记录，未修改或替换生产代码。原始抓取、独立比较脚本、
生命周期响应与 smoke 输出保存在测试主机 `/tmp/atom-alsa-acceptance-20260922/`；
此文保留持久化结论，临时文件不是唯一记录。
