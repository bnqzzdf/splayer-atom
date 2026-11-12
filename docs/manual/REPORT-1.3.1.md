# SPlayer Atom 1.3.1 使用手册报告

> 最后更新：2026-11-12
>
> 日期：2026-11-12
>
> 状态：已新增安装说明章节并完成 PDF 闸门；待上传到 GitHub Release `v1.3.1`。

## 交付物

| 项目 | 值 |
| --- | --- |
| 文件 | `docs/manual/SPlayer-Atom-使用手册-v1.3.1.pdf` |
| 大小 | 6,175,749 字节 |
| SHA256 | `423076f1b0832f1cca2d9531d613ca55dc556e48a28ef8b434666c3571ff6e13` |
| 页数 | 31 |
| 配图 | 19 张 |
| 适用版本 | SPlayer Atom 1.3.1（`7606f82c`） |
| 发布目标 | GitHub Release `v1.3.1`，资产名 `SPlayer-Atom-User-Manual-v1.3.1.pdf` |

## 本次变化

- 新增第 `01` 章「安装」：
  - 发布包与变体选择；
  - 安装前检查；
  - systemd / OpenRC 通用安装；
  - AudioSys / Buildroot 安装、CONFIG 钩子与菜单卡片；
  - 升级、卸载、回滚；
  - 安装后检查。
- 原章节顺延：第一次使用 → `02`，直至附录与发布 → `16`；图号同步顺延。
- 增加 AudioSys 控制台「SPlayer Atom 设置」菜单卡片截图（图 1-1）。
- 封面、页眉页脚、文档信息与发布链接更新为 1.3.1；手册修订记录增加 v1.1。

## 截图来源

- Web Control：`.137`，SPlayer Atom 1.3.0/1.3.1 Web UI，1440 × 900。
- AudioSys 控制台：`.170`（10.0.0.170:5000），SPlayer Atom 1.3.1 菜单卡片，1440 × 900。
- 截图不包含密码、token 或账号凭据。

## 闸门

| 闸门 | 结果 |
| --- | --- |
| `pdf_qa.py` | PASS：11 项通过；无空白页、无内容溢出、字体嵌入、标点换行、页面填充率均通过 |
| `toc.check` | PASS：目录条目有可点击链接 |
| `font.check` | PASS：无缺字 |
| 页数/配图 | 31 页 / 19 张 |
| 构建复现 | `prepare_fonts.py` + `build_manual.py` PASS |

保留的已知非缺陷项：封面底部白色带被 `pdf_qa` 识别为“非全出血”；这是参考手册的版式选择。

## 复现

```bash
cd docs/manual
python3 prepare_fonts.py
python3 build_manual.py
```

`fonts/` 为本地生成物，不进入 Git；`assets/` 保留截图源文件。
