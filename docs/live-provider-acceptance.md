# SPlayer Atom 在线服务验收

> 最后更新：2026-09-28

本文定义 Netease、QM、KG、Qobuz 与 TIDAL 的真实账号验收记录。静态测试、mock、公开元数据查询和无凭据软件 harness 不能把这些项目标记为完成。

状态（仓库记录，2026-09-23）：Core/Web 已接入五个平台；QM/KG 扫码、Cookie、搜索、详情和 Core 音源路径，以及 Qobuz 浏览器 OAuth 和仅 token 登录已实现。
这些新路径尚未针对本仓库候选包完成真实账号验收。Debian 11 两种模式的产物启动验收不等于平台账号或音频硬件验收。UPnP 方案记录了 Netease/TIDAL 的部分真实在线播放；
本文件尚无覆盖以下完整矩阵的候选包验收结果，
仍见 [Roadmap](./atom-roadmap.md)。

## 1. 通用前置条件

- 使用已记录 SHA256、Atom commit、`sourceDirty=false`、Core protocol 与 capability 的候选 artifact。
- 使用验收者授权的真实账号、真实权益和真实网络；不把账号、cookie、token 或 Authorization 写入命令、fixture、截图、日志、文档或 Git。
- Web Control 仅发送 Core Control 命令并消费 snapshot/event；最终 playable URL、刷新、重试、skip、cache 与 Diretta materialization 仍由 Core 持有。
- 普通输出使用真实 ALSA hardware；Diretta 使用 root Host 与真实 Target。软件 fake output 不算 live acceptance。
- 每项记录 `PASS`、`FAIL` 或 `BLOCKED`。权益不足、区域限制、账号未提供、硬件不可用和服务端限制都应记录为 `BLOCKED`，不得伪装为通过。

可先运行只读诊断，记录 release identity、outputs 和脱敏 session：

```bash
pnpm check:hardware-release -- --base-url http://127.0.0.1:14558
```

## 2. Netease

### Account / pages

- 登录状态能从 Core 正确同步到 Web Control。
- Favorites 首次加载、分页/刷新和收藏变更在 Headless Web 可见。
- Daily Recommendations 可加载、刷新并加入 canonical Core queue。
- Cloud 可分页、播放；删除只在验收者明确授权的测试条目上执行，并验证 Web Control 能看到 Core 的最新结果。
- logout 后 Core session 与页面状态一致，Web Control 不残留可用 credential。

### Playback

- 免费、VIP/SVIP 与可用的不同 quality 进入同一 Core playback entry。
- `fee=4` purchase-required Track 明确分类，不作为普通 VIP URL 尝试播放。
- 三首在线 queue 连续播放，native-ended 后由 Core auto-next。
- expired URL 只允许一次同 Track fresh resolve；继续失败后按 Core policy advance。
- ALSA 与 Diretta 各验证一次；Diretta 在线输入先 exact-byte materialize，且 DAC/Target 指示与源格式一致。
- scrobble/play statistics 在真实播放结束后由 Core 持久化一次，不因 Control 数量重复。

## 3. QM / KG

- 分别验证扫码、手动 Cookie、重启后会话投影与登出；Web Control 不持久化凭据，状态投影不包含 Cookie。
- 匿名搜索的单曲、专辑、歌手、歌单及详情分页返回正确的 canonical Track。
- 已登录账号分别验证整曲直链、质量档位和三首队列连续播放；无插件时走 Core 音源解析，有插件时验证兜底。
- 无权益与试听片段给出对应原因；未允许试听时不得把片段当整曲播放或缓存。
- ALSA 与 Diretta 各验证可用的无损曲目，记录实际音源格式和输出结果。

## 4. Qobuz

- 从另一台 Web Control 设备发起浏览器授权，验证回调可到达 Core 动态端口、随机路径与 state 校验、会话自动更新；重复发起、取消、超时后回调监听关闭。
- 粘贴 token 入口仍可用，且只给 token 时能从服务端确认用户身份。
- search → detail → queue → playback 使用真实账号结果；试听片段遵守试听设置。
- ALSA 与 Diretta 各验证可用的无损曲目及三首队列连续播放。

## 5. TIDAL

- 真实账号 session、subscription/quality entitlement 由 Core 保存，并能正确同步到 Web Control。
- search → detail → queue → playback 全链路使用真实结果。
- JSON/BTS 与 DASH 两种真实播放路径分别验收；记录实际命中的路径和 quality。
- 三首 queue 的 Core-owned auto-next 与连续播放通过。
- JSON/BTS、DASH 分别覆盖真实 ALSA；产品支持的 lossless/hi-res 路径再覆盖 Diretta。
- entitlement、区域或 manifest 限制必须明确报告，不允许静默降低为另一路径并标记通过。

## 6. 记录模板

```text
Provider: Netease | QM | KG | Qobuz | TIDAL
Result: PASS | FAIL | BLOCKED
Date/timezone / operator:

Artifact SHA256:
Atom version / commit / sourceDirty:
Core protocol / capability:
Provider capability:
Account tier (非账号标识):
Region (仅在与 entitlement 相关时):

Scenario:
Control surface: Web Control
Source metadata: codec / rate / bits / channels / duration
Output: ALSA device | Diretta Target
Queue length / observed auto-next:
Expected result:
Observed result:
Sanitized error / BLOCKED reason:
Notes:
```

不得记录用户名、邮箱、用户 ID（除非经过不可逆脱敏且确有必要）、cookie、token、Authorization、最终 playable URL、私有文件路径或完整 provider 响应。验收完成后只提交脱敏结论和最小复现信息。
