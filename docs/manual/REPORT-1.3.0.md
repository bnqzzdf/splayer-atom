# SPlayer Atom 1.3.0 使用手册报告

> 最后更新：2026-11-12

> 日期：2026-11-12
>
> 状态：构建、闸门、真机校验与 Release 上传完成。

## 交付物

| 项目 | 值 |
| --- | --- |
| 文件 | `docs/manual/SPlayer-Atom-使用手册-v1.3.0.pdf` |
| 大小 | 6,055,012 字节 |
| SHA256 | `3926a517d5868d81702883cd0807b58fd1cb49c1ba8267a9a8b087d4358f8a94` |
| 页数 | 29 |
| 配图 | 18 张 |
| 适用版本 | SPlayer Atom 1.3.0（`ed95ee9b`） |
| 发布结果 | GitHub Release `v1.3.0`，资产名 `SPlayer-Atom-User-Manual-v1.3.0.pdf` |

## 版式与结构

参考 `ChronoSync-使用手册-v1.5.0.pdf` 的体例：A4 竖版、深青色封面、橙色分隔线、青色章节编号、浅蓝表头、代码块、橙色提示框、页眉页脚、可点击目录与 PDF 书签。

章节：

1. 文档说明、修订记录、阅读约定
2. `00` 它是什么，不做什么
3. `01` 第一次使用
4. `02` 界面导览
5. `03` 本地曲库
6. `04` 播放与队列
7. `05` 音频输出（ALSA / Diretta / UPnP，SACD DST-DFF/DSF）
8. `06` 在线音乐与媒体源
9. `07` 歌词
10. `08` 歌单、喜欢与历史
11. `09` 下载与缓存
12. `10` 插件
13. `11` 统计
14. `12` 设置
15. `13` 多设备与数据
16. `14` 常见问题
17. `15` 附录与发布

## 截图来源

- 环境：`.137` GentooPlayer x86_64，SPlayer Atom `1.3.0`，Core `ed95ee9b`。
- 视口：1440 × 900；取首页、输出选择、曲库、专辑详情、歌曲、文件夹、播放器、队列、SACD 设置、媒体源、搜索、歌词、历史、下载、插件、统计、设置。
- 截图只包含示例曲库与设备名，不包含密码、token 或账号凭据。

## 闸门

| 闸门 | 结果 |
| --- | --- |
| `pdf_qa.py` | PASS：11 项通过；无空白页、无内容溢出、字体嵌入、标点换行、页面填充率均通过 |
| `toc.check` | PASS：目录条目有可点击链接，无警告 |
| `font.check` | PASS：无缺字 |
| 页数/配图 | 29 页 / 18 张 |
| 构建复现 | `prepare_fonts.py` 重新生成字体后 `build_manual.py` PASS |

保留的已知非缺陷项：封面底部白色带被 `pdf_qa` 识别为“非全出血”；这是参考手册的版式选择，封面主体仍为深青色。

## 构建环境

- Python 3.14
- ReportLab、pypdf
- fontTools + cu2qu + otf2ttf
- Noto Sans CJK SC（系统字体，转换为 TrueType 后嵌入）

## 复现

```bash
cd docs/manual
python3 prepare_fonts.py
python3 build_manual.py
```

`fonts/` 为本地生成物，不进入 Git；`assets/` 保留截图源文件。详细说明见 `README.md`。
