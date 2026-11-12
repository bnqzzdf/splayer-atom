# WAV 中文标签乱码分析与修复（1.3.2）

> 最后更新：2026-11-12

> 日期：2026-11-12
>
> 状态：已实现并通过 `.137` 等实体机验证；1.3.2 包已构建，待发布。

## 现象

`.137` 的曲库中 50 首 WAV 曲目中文乱码，例如：

- 标题 `��ѩ`，应为 `春雪`
- 歌手 `��ͥέ`，应为 `孟庭苇`
- 专辑 `���Ļ��Ǽٵ�`，应为 `真的还是假的`

文件路径本身正常，例如 `/mnt/samba/WAVE/孟庭苇 - 春雪.wav`。

## 取证

- 数据库中这些字段包含 `U+FFFD`（UTF-8 `EF BF BD`）和残余 GBK 字节；乱码只出现在 `.wav`，共 50 首。
- `ffprobe` 对同一文件输出两套标签：
  - 正确的 ID3v2：`title=春雪`、`artist=孟庭苇`、`album=真的还是假的`
  - 后面的 RIFF INFO：`INAM/IART/IPRD`，值为 GBK 原始字节
- `ffmpeg_audio 0.3.1` 的 `extract_dict` 用 `CStr::to_string_lossy()` 把 dictionary 值按 UTF-8 解码，再写入 `HashMap`；重复 key 后者覆盖前者，于是 GBK INFO 覆盖了正确 ID3。

## 修复

1. **WAV 专用标签读取**（`metadata::extract_tags_for_path`）：
   - FFmpeg 结果中出现 `U+FFFD` 时，改用 lofty 读取 WAV 的 ID3v2；
   - ID3v2 缺失字段再从 RIFF INFO 原始字节补齐，值先按 UTF-8，失败按 GBK 解码；
   - 非 WAV 仍走原有 `repair_legacy_gbk_tags_for_path`。
2. **扫描器 / 媒体探测统一接入**：`scanner.rs` 与 `media_probe.rs` 不再直接使用 FFmpeg 的 lossy 标签。
3. **已有库修复**：
   - DB schema v10 将受损 WAV 的 `file_mtime` 置空，保证下一次增量扫描重读；
   - Core 启动后后台执行 `repairCorruptedWavTags()`，用原生标签读取修复现有受损 WAV，并发布库 revision。
4. **测试**：
   - 原始 GBK RIFF INFO 解码；
   - FFmpeg lossy 标签回退到原始 INFO；
   - WAV 迁移只作废受损 WAV，不影响正常 WAV/FLAC/CUE。

## 边界

- 不改音频数据、播放链路或 WAV 文件；只改标签读取与数据库投影。
- 带正确 ID3v2 的文件优先使用 ID3；仅 GBK INFO 的文件由新解析器解码。
- 不尝试恢复已经丢失的任意字节，只从文件原始标签重新读取。

## 验收结果（2026-11-12）

- `.137`：升级 1.3.2 后启动日志出现 `WAV 标签编码修复: 50 首`，DB 中 U+FFFD WAV 计数从 50 降至 0；`/api/library/tracks` 返回 `春雪 / 真的还是假的 / 孟庭苇`。
- `.227`：临时端口启动后修复 3 首，DB 计数降至 0；服务保持停止（14558 由 TinySPlayer 使用）。
- `.102`：升级到 1.3.2，data/ 保留，DB 无 U+FFFD WAV。
- `.170`：AudioSys 升级到 1.3.2，菜单卡片与开机钩子保留，DB 无受损 WAV。
- `.104`：升级到 1.3.2 且服务保持停止；库中仅剩 1 条指向不存在路径的旧记录，不属于标签编码问题。
- `.230`：arm64 1.3.2 包临时前缀启动，`/api/info` 返回 1.3.2/81601faf。

## 验收计划

- `.137` 升级 1.3.2 后检查启动日志与 DB：50 首 WAV 的标题/歌手/专辑恢复中文。
- Web UI 曲库、专辑、歌手页抽查中文显示。
- `.102/.104/.227/.170` 部署后同样检查；无受损 WAV 的机器不应产生改动。
- 构建 x86 v1/v2/v3/v4/zen4 与 arm64 包，跑包闸门与真机 smoke。
