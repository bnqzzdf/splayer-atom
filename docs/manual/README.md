# SPlayer Atom 使用手册

> 最后更新：2026-11-12

本目录生成 `SPlayer-Atom-使用手册-v1.3.0.pdf`：A4、29 页、18 张 Web Control 截图。

## 构建

依赖：

- Python 3.11+
- `reportlab`、`pypdf`
- `fonttools`、`cu2qu`、`otf2ttf`
- 系统已安装 Noto Sans CJK（默认读取 `~/.fonts/NotoSansCJK-{Regular,Bold}.ttc`）

首次构建先生成 ReportLab 可嵌入的 TrueType 字体：

```bash
python3 prepare_fonts.py
python3 build_manual.py
```

如字体位于其他目录：

```bash
ATOM_CJK_FONT_DIR=/path/to/fonts python3 prepare_fonts.py
```

`fonts/` 是本地生成物，不提交到仓库。截图位于 `assets/`，来自 1.3.0 Web Control 的真实界面；示例曲库与设备名仅用于说明。
