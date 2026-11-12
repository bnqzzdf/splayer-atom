#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path
from xml.sax.saxutils import escape

from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    CondPageBreak,
    Flowable,
    Frame,
    Image,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    XPreformatted,
)
from reportlab.platypus.tableofcontents import TableOfContents

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
FONTS = ROOT / "fonts"
OUT = ROOT / "SPlayer-Atom-使用手册-v1.3.1.pdf"
TMP = ROOT / ".build-preview.pdf"

PAGE_W, PAGE_H = A4
MARGIN_L = 54
MARGIN_R = 54
MARGIN_T = 64
MARGIN_B = 56
CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R

INK = HexColor("#17333A")
TEAL = HexColor("#146C75")
TEAL_DARK = HexColor("#0B3B43")
MUTED = HexColor("#61777C")
RULE = HexColor("#D8E4E7")
TABLE_HEAD = HexColor("#EAF5F7")
TABLE_ALT = HexColor("#F7FAFB")
CODE_BG = HexColor("#F1F4F5")
ORANGE = HexColor("#C6923D")
CALLOUT_BG = HexColor("#FBF4E8")
WHITE = colors.white

FONT_REG = "NotoSansSC"
FONT_BOLD = "NotoSansSC-Bold"

pdfmetrics.registerFont(TTFont(FONT_REG, str(FONTS / "NotoSansSC-Regular.ttf")))
pdfmetrics.registerFont(TTFont(FONT_BOLD, str(FONTS / "NotoSansSC-Bold.ttf")))

BODY = ParagraphStyle(
    "Body",
    fontName=FONT_REG,
    fontSize=9.6,
    leading=15.8,
    textColor=INK,
    wordWrap="CJK",
    spaceAfter=5,
)
BODY_SMALL = ParagraphStyle(
    "BodySmall",
    parent=BODY,
    fontSize=8.8,
    leading=13.8,
    textColor=MUTED,
)
BULLET = ParagraphStyle(
    "Bullet",
    parent=BODY,
    leftIndent=14,
    bulletIndent=2,
    bulletFontName=FONT_REG,
    spaceAfter=3,
)
H2 = ParagraphStyle(
    "H2",
    fontName=FONT_BOLD,
    fontSize=12.5,
    leading=18,
    textColor=TEAL,
    wordWrap="CJK",
    spaceBefore=12,
    spaceAfter=6,
)
H3 = ParagraphStyle(
    "H3",
    fontName=FONT_BOLD,
    fontSize=10.4,
    leading=15,
    textColor=INK,
    wordWrap="CJK",
    spaceBefore=8,
    spaceAfter=3,
)
TABLE_CELL = ParagraphStyle(
    "TableCell",
    fontName=FONT_REG,
    fontSize=8.1,
    leading=11.6,
    textColor=INK,
    wordWrap="CJK",
)
TABLE_HEAD_CELL = ParagraphStyle(
    "TableHeadCell",
    parent=TABLE_CELL,
    fontName=FONT_BOLD,
    textColor=INK,
)
CAPTION = ParagraphStyle(
    "Caption",
    fontName=FONT_REG,
    fontSize=7.6,
    leading=10.5,
    textColor=MUTED,
    alignment=TA_CENTER,
    wordWrap="CJK",
    spaceAfter=9,
)
CODE = ParagraphStyle(
    "Code",
    fontName=FONT_REG,
    fontSize=8.0,
    leading=11.8,
    textColor=INK,
    backColor=CODE_BG,
    borderPadding=(6, 8, 6, 8),
    wordWrap="CJK",
    spaceBefore=3,
    spaceAfter=8,
)
CALLOUT = ParagraphStyle(
    "Callout",
    fontName=FONT_REG,
    fontSize=8.8,
    leading=13.5,
    textColor=INK,
    wordWrap="CJK",
)
TOC_TITLE = ParagraphStyle(
    "TOCTitle",
    fontName=FONT_BOLD,
    fontSize=22,
    leading=30,
    textColor=INK,
    spaceAfter=12,
)
DOC_TITLE = ParagraphStyle(
    "DocTitle",
    fontName=FONT_BOLD,
    fontSize=22,
    leading=30,
    textColor=INK,
    spaceAfter=12,
)
COVER_SMALL = ParagraphStyle(
    "CoverSmall",
    fontName=FONT_REG,
    fontSize=8,
    leading=11,
    textColor=MUTED,
)


class ChapterHeading(Flowable):
    def __init__(self, number: str, title: str):
        super().__init__()
        self.number = number
        self.title = title
        self.toc_text = f"{number}  {title}"
        self.height = 54

    def wrap(self, available_width, available_height):
        self.width = available_width
        return available_width, self.height

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFillColor(TEAL)
        c.setFont(FONT_BOLD, 22)
        c.drawString(0, 16, self.number)
        c.setFillColor(INK)
        c.setFont(FONT_BOLD, 20)
        c.drawString(44, 16, self.title)
        c.setStrokeColor(RULE)
        c.setLineWidth(0.8)
        c.line(0, 1, self.width, 1)
        c.restoreState()


class SectionHeading(Paragraph):
    def __init__(self, text: str):
        super().__init__(text, H2)
        self.toc_text = text


class DocumentHeading(Paragraph):
    def __init__(self, text: str):
        super().__init__(text, DOC_TITLE)
        self.toc_text = text


def p(text: str, style=BODY):
    return Paragraph(text, style)


def bullets(items):
    return [Paragraph(item, BULLET, bulletText="•") for item in items]


def h2(text):
    return SectionHeading(text)


def table(data, widths, header=True, repeat=True, align="LEFT"):
    rows = []
    for r, row in enumerate(data):
        rows.append([
            Paragraph(str(cell), TABLE_HEAD_CELL if header and r == 0 else TABLE_CELL)
            for cell in row
        ])
    t = Table(rows, colWidths=widths, repeatRows=1 if header and repeat else 0, hAlign="CENTER")
    if len(data) <= 9:
        t.splitByRow = 0
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE),
        ("BACKGROUND", (0, 1), (-1, -1), colors.white),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, TABLE_ALT]),
    ]
    if header:
        style += [
            ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEAD),
            ("LINEABOVE", (0, 0), (-1, 0), 0.9, TEAL),
        ]
    t.setStyle(TableStyle(style))
    return t


def callout(text: str, warn=True):
    bg = CALLOUT_BG if warn else TABLE_HEAD
    bar = ORANGE if warn else TEAL
    t = Table([[Paragraph(text, CALLOUT)]], colWidths=[CONTENT_W], hAlign="CENTER")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("LINEBEFORE", (0, 0), (0, -1), 3, bar),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return KeepTogether([Spacer(1, 3), t, Spacer(1, 8)])


def code(text: str):
    return XPreformatted(text.strip("\n"), CODE)


def figure(path: Path, caption: str, width=CONTENT_W, max_height=250):
    img = Image(str(path))
    iw, ih = img.imageWidth, img.imageHeight
    scale = min(width / iw, max_height / ih)
    img.drawWidth = iw * scale
    img.drawHeight = ih * scale
    img.hAlign = "CENTER"
    cap = Paragraph(caption, CAPTION)
    return KeepTogether([Spacer(1, 3), img, Spacer(1, 3), cap])


TOTAL_PAGES = 0


class ManualDoc(BaseDocTemplate):
    def __init__(self, filename, **kwargs):
        super().__init__(filename, **kwargs)
        self._bm = 0

    def afterFlowable(self, flowable):
        if isinstance(flowable, (ChapterHeading, DocumentHeading)):
            level = 0
            text = flowable.toc_text
        elif isinstance(flowable, SectionHeading):
            level = 1
            text = flowable.toc_text
        else:
            return
        key = "bm-" + hashlib.md5(f"{level}:{text}".encode("utf-8")).hexdigest()
        self._bm += 1
        self.notify("TOCEntry", (level, text, self.page, key))
        self.canv.bookmarkPage(key)
        self.canv.addOutlineEntry(text, key, level=level, closed=(level == 0))


def draw_cover(c: canvas.Canvas, doc):
    if doc.page != 1:
        return
    c.saveState()
    # Dark field and accent rule
    c.setFillColor(TEAL_DARK)
    c.rect(0, 240, PAGE_W, PAGE_H - 240, fill=1, stroke=0)
    c.setFillColor(ORANGE)
    c.rect(0, 237, PAGE_W, 3, fill=1, stroke=0)
    c.setFillColor(WHITE)

    # Top label
    c.setFillColor(HexColor("#C6D8DA"))
    c.setFont(FONT_REG, 8)
    c.drawString(54, PAGE_H - 58, "SPLAYER ATOM  /  LINUX CORE · WEB CONTROL")
    c.setStrokeColor(HexColor("#7FA0A4"))
    c.setLineWidth(0.6)
    c.rect(PAGE_W - 126, PAGE_H - 66, 72, 20, fill=0, stroke=1)
    c.setFillColor(WHITE)
    c.setFont(FONT_REG, 7)
    c.drawCentredString(PAGE_W - 90, PAGE_H - 59.5, "DOC v1.3.1")

    # Hero
    c.setFillColor(WHITE)
    c.setFont(FONT_BOLD, 30)
    c.drawString(54, 638, "SPlayer Atom")
    c.setFont(FONT_BOLD, 45)
    c.drawString(54, 572, "使用手册")
    c.setFillColor(HexColor("#D2E1E3"))
    c.setFont(FONT_REG, 11)
    c.drawString(54, 520, "Core · Web Control · ALSA · Diretta · UPnP")
    c.setFillColor(HexColor("#C6D8DA"))
    c.setFont(FONT_REG, 9.5)
    c.drawString(54, 496, "本地曲库、播放队列、音频输出与在线音乐")

    # Bottom package table
    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 8.5)
    c.drawString(54, 210, "本手册覆盖的发布包")
    y = 186
    cols = [54, 238, 300, 366, 530]
    headers = ["包", "版本", "大小", "定位"]
    c.setFont(FONT_BOLD, 7.6)
    c.setFillColor(INK)
    for text, x in zip(headers, cols):
        c.drawString(x, y, text)
    c.setStrokeColor(TEAL)
    c.setLineWidth(0.8)
    c.line(54, y - 5, PAGE_W - 54, y - 5)
    rows = [
        ("Linux x86_64 multi", "1.3.1", "90 MB", "v1/v2/v3/v4/zen4；v1 为 ALSA-only"),
        ("Linux ARM64 multi", "1.3.1", "55 MB", "arm64 原生构建；含 Diretta"),
        ("使用手册", "1.3.1", "PDF", "本文件；与发布包一并转交"),
    ]
    row_y = y - 28
    for i, row in enumerate(rows):
        c.setFillColor(INK)
        c.setFont(FONT_REG, 7.6)
        for text, x in zip(row, cols):
            c.drawString(x, row_y, text)
        c.setStrokeColor(RULE)
        c.setLineWidth(0.4)
        c.line(54, row_y - 8, PAGE_W - 54, row_y - 8)
        row_y -= 30
    # Bottom notes
    c.setFillColor(MUTED)
    c.setFont(FONT_REG, 7)
    c.drawString(54, 42, "内部技术文档 · 可打印分发 · 请与发布包一并转交")
    c.drawRightString(PAGE_W - 54, 42, f"共 {TOTAL_PAGES or '—'} 页 · 2026-11-12")
    c.restoreState()


def draw_header_footer(c: canvas.Canvas, doc):
    if doc.page == 1:
        return
    c.saveState()
    c.setStrokeColor(RULE)
    c.setLineWidth(0.6)
    c.line(MARGIN_L, PAGE_H - 46, PAGE_W - MARGIN_R, PAGE_H - 46)
    c.setFillColor(MUTED)
    c.setFont(FONT_REG, 7.2)
    c.drawString(MARGIN_L, PAGE_H - 38, "SPLAYER ATOM · 使用手册")
    c.drawRightString(PAGE_W - MARGIN_R, PAGE_H - 38, "v1.3.1")
    c.setStrokeColor(HexColor("#E7EEF0"))
    c.line(MARGIN_L, 39, PAGE_W - MARGIN_R, 39)
    c.setFont(FONT_REG, 7.2)
    c.setFillColor(MUTED)
    c.drawString(MARGIN_L, 27, "v1.3.1 · 2026-11-12")
    c.drawRightString(PAGE_W - MARGIN_R, 27, f"第 {doc.page} 页 / 共 {TOTAL_PAGES or '—'} 页")
    c.restoreState()


def cover_page():
    class Cover(Flowable):
        def wrap(self, aw, ah):
            return PAGE_W, PAGE_H

        def draw(self):
            pass
    return Cover()


def document_info():
    story = [DocumentHeading("文档说明")]
    story.append(p(
        "本手册对应 SPlayer Atom 1.3.1 的 Linux x86-64 / aarch64 发布包与浏览器 Web Control。"
        "内容按「第一次使用 → 曲库 → 播放 → 输出 → 在线音乐 → 设置与排障」组织，"
        "既可以顺序阅读，也可以按目录跳转。"
    ))
    story.append(Spacer(1, 4))
    story.append(h2("文档信息"))
    story.append(table([
        ["项目", "内容"],
        ["文档名称", "SPlayer Atom 使用手册"],
        ["文档版本", "v1.3.1（2026-11-12）"],
        ["适用平台", "Linux x86-64 / aarch64；浏览器 Web Control"],
        ["发布形态", "多架构 tar.gz；内置 Node 24.22.2"],
        ["默认端口", "Core HTTP/WS 14558"],
        ["音频输出", "ALSA / Diretta Source Direct / UPnP Renderer"],
        ["发布范围", "内部技术文档，可打印分发；请与发布包一并转交"],
    ], [0.24 * CONTENT_W, 0.76 * CONTENT_W]))
    story.append(Spacer(1, 8))
    story.append(h2("修订记录"))
    story.append(table([
        ["版本", "日期", "说明"],
        ["v1.0", "2026-11-12", "首版；对应 SPlayer Atom 1.3.0，包含 SACD DST-DFF 与多架构包。"],
        ["v1.1", "2026-11-12", "新增安装说明章节；适配 1.3.1 AudioSys 菜单与安装器。"],
    ], [0.15 * CONTENT_W, 0.22 * CONTENT_W, 0.63 * CONTENT_W]))
    story.append(Spacer(1, 8))
    story.append(h2("阅读约定"))
    story.extend(bullets([
        "命令示例默认以 root 执行；普通用户部署时，按实际账户调整权限。",
        "示例地址使用文档保留网段（如 192.168.1.20），不代表真实设备。",
        "开始播放前必须先选择输出设备；没有选择时 Core 会返回 OUTPUT_DEVICE_REQUIRED。",
        "Diretta 与 ALSA Direct 是严格输出路径；样本处理控件被锁定是设计约束，不是故障。",
        "真实密码、token 与设备清单不写入本手册，也不要放进日志或截图。",
    ]))
    return story


def toc_page():
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle(
            name="TOC0", fontName=FONT_BOLD, fontSize=10.2, leading=19,
            textColor=INK, spaceBefore=4, leftIndent=0, firstLineIndent=0,
        ),
        ParagraphStyle(
            name="TOC1", fontName=FONT_REG, fontSize=8.9, leading=14.5,
            textColor=MUTED, leftIndent=18, firstLineIndent=0,
        ),
    ]
    toc.dotsMinLevel = 0
    return [Paragraph("目录", DOC_TITLE), Spacer(1, 4), toc]


def chapter_00():
    s = [ChapterHeading("00", "它是什么，不做什么")]
    s.append(p(
        "SPlayer Atom 由两部分组成：运行在 Linux 音乐主机上的 <b>Core</b>，以及浏览器里的 "
        "<b>Web Control</b>。Core 持有曲库、队列、播放、缓存、下载、统计与在线账号；"
        "Web Control 只发送命令并展示 Core 的投影。"
    ))
    s.append(table([
        ["角色", "运行位置", "负责什么"],
        ["Core", "Linux 音乐主机", "曲库索引、队列、播放状态、音频输出、缓存、下载、插件、账号"],
        ["Web Control", "电脑 / 平板 / 手机浏览器", "展示界面、发送播放与曲库命令、保存浏览器本地显示偏好"],
        ["ALSA / Diretta / UPnP", "Core 或局域网 Renderer", "实际出声；同一时刻只选择一个活动输出"],
    ], [0.20 * CONTENT_W, 0.26 * CONTENT_W, 0.54 * CONTENT_W]))
    s.append(h2("它不做什么"))
    s.extend(bullets([
        "不删除、移动或重命名用户的音乐文件；清理只针对 Atom 自有缓存、临时文件与未完成下载。",
        "不提供公网级身份认证、TLS 或多用户隔离；只应部署在可信局域网。",
        "不在 Diretta 或 ALSA Direct 上做重采样、EQ、音量、变速、DoP 或 DSD 转 PCM。",
        "不把浏览器当成播放权威；关闭网页不会停止 Core 中正在播放的音乐。",
    ]))
    s.append(callout(
        "三条硬规矩：先选择输出再播放；不要同时启用两个播放软件争用同一输出；"
        "升级或迁移前保留 <b>data/</b>。曲库索引、设置、歌单、统计与登录状态都在这里。"
    ))
    s.append(h2("1.3.1 的新增能力"))
    s.extend(bullets([
        "AudioSys/Buildroot 安装适配与网页菜单卡片；程序安装到 /audiosys/splayer-atom-core，重启不丢。",
        "UPnP 播放 SACD DST 轨默认直通 DST 压缩 DFF，不再先解码成 DSF；Renderer 不支持时可切换 DSF 回退。",
        "发布包按架构拆分：x86-64 含 v1/v2/v3/v4/zen4，aarch64 含 arm64；安装器按 CPU 自动选择。",
        "本手册的截图来自 1.3.1 Web Control 与 AudioSys 控制台；不同浏览器的字体与缩放可能略有差异。",
    ]))
    s.append(h2("0.3 适用与不适用"))
    s.append(table([
        ["场景", "是否适合", "建议"],
        ["可信局域网、单用户、单活动输出", "适合", "本手册的默认部署形态"],
        ["本地曲库 + 在线平台 + 自建媒体源", "适合", "按需登录与配置媒体源"],
        ["多用户、公网直连、内置 TLS", "不适合", "需要新的产品需求与反向代理"],
        ["严格 Diretta 上做 EQ/音量/重采样", "不适合", "改用 ALSA Processed，或关闭这些处理"],
    ], [0.42 * CONTENT_W, 0.18 * CONTENT_W, 0.40 * CONTENT_W]))
    return s


def chapter_01_install():
    s = [ChapterHeading("01", "安装")]
    s.append(p(
        "SPlayer Atom 以多架构 tar.gz 发布，包内自带 Node 运行时和统一安装器。"
        "安装器会根据 CPU 选择变体，保留已有 <b>data/</b>，并按目标系统注册 systemd、OpenRC 或 AudioSys 启动方式。"
    ))
    s.append(h2("1.1 选择发布包"))
    s.append(table([
        ["包", "变体", "适合"],
        ["linux-x86_64-multi", "v1 / v2 / v3 / v4 / zen4", "x86-64 主机；v1 为 ALSA-only，其余带 Diretta"],
        ["linux-aarch64-multi", "arm64", "aarch64 主机；带 Diretta"],
    ], [0.26 * CONTENT_W, 0.30 * CONTENT_W, 0.44 * CONTENT_W]))
    s.append(p(
        "包内包含 Core JS、Web Control、原生 addon、内置 Node 24.22.2 与安装器。"
        "Diretta 变体使用 SDK 148；SDK 本身不随包分发。"
    ))
    s.append(h2("1.2 安装前检查"))
    s.append(table([
        ["项目", "要求"],
        ["权限", "root（Diretta 与系统服务注册需要）"],
        ["系统", "Linux x86_64 或 aarch64"],
        ["磁盘", "至少约 1.5 GB 可用空间（安装 + 临时解包）"],
        ["端口", "14558 未被其他服务占用"],
        ["数据", "升级前保留安装根下的 data/"],
    ], [0.22 * CONTENT_W, 0.78 * CONTENT_W]))
    s.append(h2("1.3 通用安装（systemd / OpenRC）"))
    s.append(p("解包后进入目录，执行安装器。默认安装到 /opt/splayer-atom-core；"
               "systemd 与 OpenRC 会自动检测，也可以显式传 --init。"))
    code("""tar -xzf splayer-atom-core-<版本>-<提交>-<日期>-linux-x86_64-multi.tar.gz
cd splayer-atom-core-<版本>-<提交>-<日期>-linux-x86_64-multi
sudo ./install.sh --cpu auto --init auto""")
    s.append(table([
        ["系统", "服务管理"],
        ["systemd", "systemctl status splayer-atom-core"],
        ["OpenRC", "rc-service splayer-atom-core status"],
    ], [0.22 * CONTENT_W, 0.78 * CONTENT_W]))
    s.append(p("升级时安装器会停止旧服务、备份程序文件、替换程序面并保留 data/；"
               "旧安装保留在 .backup-&lt;时间戳&gt;/，可用 --rollback 恢复。"))
    s.append(h2("1.4 AudioSys / Buildroot 安装"))
    s.append(p(
        "AudioSys 的根文件系统是内存盘，只有 /audiosys（p3）与 CONFIG 分区（p2）持久。"
        "安装器检测到 /audiosys 与 /dpdk/diretta.sh 后会自动切换到 AudioSys 模式，"
        "默认安装到 <b>/audiosys/splayer-atom-core</b>；也可以显式执行："
    ))
    code("""sudo ./install.sh --init audiosys""")
    s.append(p(
        "安装器会写入 CONFIG 分区 networkfs.sh 的幂等开机钩子，每次开机重建 "
        "/usr/local/bin/splayeratomctl 与网页菜单卡片。菜单卡片位于"
        "「01. 播放设置 → SPlayer Atom 设置」，可执行 status/start/stop/restart/update；"
        "start/stop 同时决定下次开机是否自启。"
    ))
    s.append(figure(ASSETS / "audiosys-splayeratom-card.png", "图 1-1 AudioSys 控制台的 SPlayer Atom 菜单卡片：动作、升级包与实时输出。", max_height=245))
    s.append(p(
        "update 接受面板上传的 splayer-atom-core-*.tar.gz，解包后调用新安装器，保留 data/ 与登录状态。"
        "卸载使用 --uninstall（保留 data/）；--purge 才删除 data/。"
    ))
    s.append(h2("1.5 升级、卸载与回滚"))
    s.append(table([
        ["操作", "命令 / 行为"],
        ["升级", "停止服务 → 备份 → 替换程序 → 启动；保留 data/"],
        ["AudioSys 升级", "菜单卡片动作 update，上传新包"],
        ["卸载（保留数据）", "./install.sh --uninstall"],
        ["彻底卸载", "./install.sh --uninstall --purge"],
        ["回滚", "./install.sh --rollback（使用最近一次 .backup-*）"],
    ], [0.26 * CONTENT_W, 0.74 * CONTENT_W]))
    s.append(h2("1.6 安装后检查"))
    s.append(table([
        ["检查项", "通过标准"],
        ["Core 版本", "/api/info 返回 version=1.3.1、sourceDirty=false"],
        ["Web Control", "浏览器能打开 http://&lt;主机 IP&gt;:14558"],
        ["输出设备", "播放栏显示已选设备，不是「选择输出」"],
        ["数据目录", "安装根下存在 data/，升级后仍在"],
        ["AudioSys 菜单", "「01. 播放设置」出现 SPlayer Atom 设置"],
    ], [0.28 * CONTENT_W, 0.72 * CONTENT_W]))
    s.append(callout(
        "在 AudioSys 上不要把安装根设为 /opt：/opt 是内存盘，重启后程序和菜单都会丢失。"
        "安装器默认会选 /audiosys/splayer-atom-core；如需自定义，必须仍放在 /audiosys 下。"
    ))
    return s


def chapter_02():
    s = [ChapterHeading("02", "第一次使用")]
    s.append(h2("2.1 打开界面"))
    s.append(p(
        "在浏览器访问 <b>http://&lt;Core 主机 IP&gt;:14558</b>。例如 Core 主机是 192.168.1.20，"
        "则打开 http://192.168.1.20:14558。首次使用也可以访问 <b>#/onboarding</b> 查看引导页；"
        "当前版本不会强制跳转。"
    ))
    s.append(p(
        "如果打不开：确认 Core 服务已启动、设备与 Core 在同一局域网、防火墙放行 14558。"
    ))
    s.append(p(
        "通过域名或反向代理访问时，请让管理员把域名加入 <b>ATOM_ALLOWED_HOSTS</b>。"
    ))
    s.append(figure(ASSETS / "home.png", "图 2-1 首页：左侧导航、推荐内容与底部播放栏；关闭页面不会中断播放。"))
    s.append(h2("2.2 选择音频输出"))
    s.append(p(
        "第一次播放前必须选择输出设备。没有选择时，Core 返回 <b>OUTPUT_DEVICE_REQUIRED</b>，"
        "界面会弹出输出选择器。输出分三组："
    ))
    s.append(table([
        ["类型", "说明", "适合"],
        ["ALSA", "Core 主机上的声卡或 USB DAC", "主机直连 DAC"],
        ["Diretta", "Diretta Target，严格 Source Direct", "严格 HiFi 链路"],
        ["UPnP", "局域网内的 UPnP Renderer", "网络播放器或另一台音乐主机"],
    ], [0.18 * CONTENT_W, 0.44 * CONTENT_W, 0.38 * CONTENT_W]))
    s.append(figure(ASSETS / "output.png", "图 2-2 输出设备选择器：ALSA、Diretta 与 UPnP 设备在同一面板中切换。"))
    s.append(h2("2.3 添加曲库"))
    s.append(p(
        "打开 <b>设置 → 本地曲库</b>，点击「添加文件夹」。目录选择发生在 Core 主机上，"
        "不是浏览器所在设备；已加入的目录会显示在「音乐目录」列表中。"
    ))
    s.append(p(
        "保存后执行「增量扫描」；需要重新读取全部文件时使用「全量重新扫描」。"
        "扫描进度会显示当前文件；一个 Core 同时只允许一个扫描，可以取消。"
    ))
    s.append(figure(ASSETS / "settings-library.png", "图 2-3 本地曲库设置：添加 Core 主机上的音乐目录并启动扫描。", max_height=180))
    s.append(h2("2.4 开始播放"))
    s.append(p(
        "进入「歌曲」「专辑」「歌手」或「文件夹」，点击曲目或「播放全部」。底部播放栏会出现，"
        "包含封面、标题、上一首/播放暂停/下一首、进度、循环、音量、输出设备与队列。"
        "点击封面进入全屏播放器。"
    ))
    s.append(callout(
        "第一次使用不要直接点「一键校时」之类的批量操作；先确认输出设备、曲库目录和一首本地曲目能正常播放。"
        "在线平台还需要单独登录。"
    ))
    s.append(h2("2.5 首次使用检查表"))
    s.append(table([
        ["检查项", "通过标准"],
        ["Core 服务", "浏览器能打开 http://<主机 IP>:14558"],
        ["输出设备", "播放栏显示已选设备，不是「选择输出」"],
        ["曲库目录", "设置 → 本地曲库中能看到至少一个目录"],
        ["扫描", "扫描完成，歌曲页有曲目"],
        ["播放", "本地曲目能开始、暂停、继续，进度会推进"],
        ["在线平台（可选）", "平台显示已登录，能打开榜单或搜索"],
    ], [0.30 * CONTENT_W, 0.70 * CONTENT_W]))
    return s


def chapter_03():
    s = [ChapterHeading("03", "界面导览")]
    s.append(h2("3.1 侧边栏"))
    s.append(p("侧边栏是主要入口。登录在线平台或启用下载、插件后，会追加对应入口；"
               "分组、顺序、隐藏与折叠可在 <b>设置 → 外观设置 → 自定义侧边栏</b> 调整。"))
    s.append(table([
        ["入口", "用途"],
        ["首页", "推荐、反复聆听、最近播放与快捷操作"],
        ["专辑 / 艺术家 / 歌曲", "本地曲库的三种聚合视图"],
        ["文件夹", "浏览 Core 主机上已加入曲库的目录"],
        ["统计", "曲库概览、热力图、时段分布、音质构成与 Top 榜"],
        ["我喜欢的音乐", "本地红心与网易云红心两个来源"],
        ["我的收藏 / 我的云盘", "网易云收藏与云盘（需登录）"],
        ["媒体源", "已配置的自建流媒体服务器"],
        ["播放历史", "当前浏览器本地的最近播放记录"],
        ["我的歌单", "本地歌单与在线歌单"],
    ], [0.25 * CONTENT_W, 0.75 * CONTENT_W]))
    s.append(h2("3.2 顶部与搜索"))
    s.append(p(
        "顶部左侧是前进/后退，中间是搜索框，右侧是账号与设置。搜索支持本地、流媒体与在线平台三类来源；"
        "搜索结果按歌曲、专辑、歌手、歌单分 tab，每页 50 条，滚动加载。"
    ))
    s.append(h2("3.3 底部播放栏"))
    s.append(table([
        ["区域", "内容"],
        ["左侧", "封面、标题、歌手；点击封面进入全屏播放器"],
        ["中间", "上一首、播放/暂停、下一首、循环/随机"],
        ["右侧", "输出设备、音量、EQ/倍速/定时/队列等菜单"],
        ["进度", "拖动定位；悬停显示时间与歌词提示"],
    ], [0.22 * CONTENT_W, 0.78 * CONTENT_W]))
    s.append(p(
        "手机上播放栏固定在底部并适配安全区；全屏播放器默认先显示封面，点击封面切到歌词。"
        "当前版本没有全局播放快捷键，键盘交互主要集中在搜索弹窗与表单。"
    ))
    s.append(h2("3.4 常见界面状态"))
    s.append(table([
        ["状态", "含义", "处理"],
        ["扫描中", "Core 正在读取目录", "等待完成；可取消后重试"],
        ["未选择输出", "播放前必须先选设备", "打开输出选择器"],
        ["连接中断", "WebSocket 正在重连", "刷新页面或检查网络"],
        ["加载失败", "曲目/封面/接口失败", "查看提示与 Core 日志"],
    ], [0.20 * CONTENT_W, 0.42 * CONTENT_W, 0.38 * CONTENT_W]))
    return s


def chapter_04():
    s = [ChapterHeading("04", "本地曲库")]
    s.append(h2("4.1 歌曲"))
    s.append(p("歌曲页提供完整的本地曲目列表，支持搜索标题、歌手、专辑与路径；可按标题、歌手、专辑、"
               "路径、时长、大小、修改时间、创建时间或音轨号排序。"))
    s.append(table([
        ["操作", "说明"],
        ["播放全部", "以当前列表为队列开始播放"],
        ["批量管理", "批量加入队列、下载、加入歌单或移除"],
        ["编辑标签", "修改标题、歌手、专辑、流派、年份、音轨号、碟号、歌词与封面"],
        ["打开所在文件夹", "定位到 Core 主机上的真实目录；CUE/SACD 定位到容器文件"],
    ], [0.24 * CONTENT_W, 0.76 * CONTENT_W]))
    s.append(figure(ASSETS / "songs.png", "图 4-1 歌曲页：音质标签、专辑、时长、大小与收藏操作集中在一行。"))
    s.append(h2("4.2 专辑与歌手"))
    s.append(p("专辑按专辑聚合，可进入详情查看多碟、曲目、总时长与音质；歌手页按歌手聚合。"
               "专辑详情支持「打开专辑所在目录」，CUE/SACD 会定位到容器文件所在目录。"))
    s.append(figure(ASSETS / "albums.png", "图 4-2 专辑网格：封面、专辑名、歌手与添加时间排序。"))
    s.append(figure(ASSETS / "album-detail.png", "图 4-3 专辑详情：DSD64 标识、曲目列表与批量操作。"))
    s.append(h2("4.3 文件夹浏览"))
    s.append(p("文件夹页直接浏览 Core 主机文件系统，但只能浏览已加入曲库的扫描目录。"
               "支持面包屑、列表/网格、排序、当前目录筛选、递归搜索、批量选择、播放、加入队列、"
               "加入歌单、扫描当前目录、图片/PDF/文本预览，以及 CUE/SACD 容器展开。"))
    s.append(figure(ASSETS / "folders.png", "图 4-4 文件夹页：音乐位置来自 Core 主机，不是浏览器本机。"))
    s.append(callout(
        "文件夹操作不会删除文件。批量操作只影响队列与歌单；Atom 不提供删除用户音乐文件的命令或界面。"
    ))
    s.append(h2("4.4 CUE 与 SACD"))
    s.extend(bullets([
        "CUE 仅支持单 FILE 的整轨镜像；分轨 CUE 会显示为独立曲目。",
        "SACD ISO 会展开为立体声分轨；当前版本只支持双声道 SACD。",
        "容器条目可以展开后单轨播放、下一首、入队或加入歌单。",
        "Direct 输出下 CUE 使用 75fps 精确边界并支持无缝；UPnP 下 CUE/SACD 会生成临时文件，首次播放可能稍慢。",
    ]))
    s.append(h2("4.5 标签编辑与红心"))
    s.append(p("编辑标签只提交有变化的字段，空字符串或 0 表示清除。若编辑的是当前播放曲目，"
               "Core 会先停止、写入、重新加载并恢复进度；封面下载失败时只跳过封面，文本仍会写入。"))
    s.append(p("「我喜欢的音乐」有本地红心与网易云红心两个 tab，数据来源不同，不会互相同步。"))
    s.append(h2("4.6 曲库维护"))
    s.append(table([
        ["操作", "何时使用"],
        ["增量扫描", "新增或修改了少量文件"],
        ["全量重新扫描", "目录结构变化、标签批量修改或曲目缺失"],
        ["编辑标签", "修正标题、歌手、专辑、音轨号或封面"],
        ["打开所在文件夹", "核对真实路径，或定位 CUE/SACD 容器"],
    ], [0.24 * CONTENT_W, 0.76 * CONTENT_W]))
    return s


def chapter_05():
    s = [ChapterHeading("05", "播放与队列")]
    s.append(p("队列、当前曲目、循环/随机、自动下一首和错误恢复都由 Core 管理。多个浏览器看到同一队列；"
               "在任一浏览器修改，其他浏览器会收到更新。"))
    s.append(figure(ASSETS / "player2.png", "图 5-1 全屏播放器：封面与歌词分栏，底部保留播放、输出与队列控制。", max_height=270))
    s.append(h2("5.1 队列操作"))
    s.append(p("点击底部播放栏的队列按钮打开「播放列表」。可以播放全部、下一首播放、加入队列、"
               "拖动排序、移除单曲、清空队列、定位当前曲目，并查看剩余总时长。"))
    s.append(table([
        ["操作", "行为"],
        ["播放全部", "用当前列表替换队列并开始播放"],
        ["下一首播放", "插入到当前曲目之后"],
        ["加入队列", "追加到队尾，不打断当前播放"],
        ["拖动排序", "只改变队列顺序，不改变正在播放的曲目"],
        ["清空队列", "停止播放并移除全部曲目"],
    ], [0.24 * CONTENT_W, 0.76 * CONTENT_W]))
    s.append(figure(ASSETS / "queue2.png", "图 5-2 播放队列：右侧面板展示当前队列与总曲目数。", max_height=270))
    s.append(h2("5.2 循环与随机"))
    s.append(table([
        ["模式", "行为"],
        ["循环关", "播放到队尾后停止"],
        ["列表循环", "队尾回到第一首"],
        ["单曲循环", "当前曲结束后重载当前曲"],
        ["随机开", "当前曲保持在首位，其余随机；关闭随机恢复原顺序"],
    ], [0.22 * CONTENT_W, 0.78 * CONTENT_W]))
    s.append(p("注意：「上一首」在队列第一首时会环绕到队尾，即使循环关闭。这是当前行为。"))
    s.append(h2("5.3 自动下一首与失败跳过"))
    s.extend(bullets([
        "正常结束会自动加载下一首。",
        "单曲加载失败时，Core 最多尝试 min(5, 队列长度) 次。",
        "设备类错误、未知错误不会自动跳过；在线音源 URL 过期时，Core 会对同一首歌重新解析一次。",
        "队列只有一首时，不会跳到别的歌。",
    ]))
    s.append(h2("5.4 预载与无缝"))
    s.append(table([
        ["输出", "行为"],
        ["ALSA Processed", "未使用 CUE/SACD/DSD 且变速/变调为 bypass 时，可无缝衔接普通 PCM"],
        ["ALSA Direct / Diretta", "后台准备下一首；同 wire-format 时无缝"],
        ["UPnP", "不支持 gapless，每首重新加载"],
    ], [0.26 * CONTENT_W, 0.74 * CONTENT_W]))
    s.append(h2("5.5 定时关闭、A/B 与样本处理"))
    s.append(p("播放栏菜单提供定时关闭（1～180 分钟，可等当前歌曲结束）、A/B 循环、倍速 0.5～2.0、"
               "音调 ±12 半音、10 段 EQ、响度均衡与淡入淡出。"))
    s.append(callout(
        "倍速、音调、EQ、响度与淡入淡出只在 ALSA Processed 下可用。"
        "ALSA Direct、Diretta 与 UPnP 会锁定这些控件，音量显示为 1；这是输出路径约束。"
    ))
    s.append(h2("5.6 私人 FM 与心动模式"))
    s.append(p("私人 FM 需要网易云登录，可选默认/熟悉/探索/场景模式；FM 模式下「下一首」变为「不喜欢」。"
               "心动模式以当前网易云歌曲或随机红心歌曲为种子生成推荐队列。FM 池与心动队列不持久化，"
               "Core 重启后回到普通队列。"))
    s.append(h2("5.7 播放页布局"))
    s.append(table([
        ["设置", "行为"],
        ["播放页布局", "经典、全屏封面、AM 三种布局"],
        ["播放器背景", "模糊、纯色或流体动画"],
        ["封面/歌词占比", "调整全屏播放器封面与歌词区域的宽度"],
        ["自动沉浸模式", "鼠标静止或离开窗口时隐藏顶/底栏与鼠标"],
        ["跟随封面颜色", "歌词颜色跟随当前封面主色调"],
    ], [0.26 * CONTENT_W, 0.74 * CONTENT_W]))
    s.append(p("布局偏好保存在当前浏览器，不影响其他设备。AMLL 与流体背景资源占用较高；"
               "低性能设备优先使用经典布局 + 模糊背景。"))
    return s


def chapter_06():
    s = [ChapterHeading("06", "音频输出")]
    s.append(p("输出设备决定声音从哪里出、允许哪些处理。切换输出时，Core 会尝试重新加载当前曲目并恢复位置与播放状态；"
               "失败时可能停止播放，需要重新点播放。"))
    s.append(h2("6.1 ALSA"))
    s.append(p("ALSA 设备来自 Core 主机的真实硬件端点，名称形如 alsa:hw:CARD=xxx,DEV=0；"
               "不提供 default/plughw/softvol 这类虚拟设备。"))
    s.append(p("HDMI/DisplayPort 端点默认隐藏，只有当前已选中时才显示。"))
    s.append(table([
        ["模式", "特点", "可用处理"],
        ["Processed", "日常使用；仅 mono/stereo；不做 ALSA 重采样", "EQ、响度、变速、变调、淡入淡出"],
        ["Direct", "保留有效位；整数不转 float；支持原生 DSD", "无样本处理"],
    ], [0.18 * CONTENT_W, 0.46 * CONTENT_W, 0.36 * CONTENT_W]))
    s.append(h2("6.2 Diretta"))
    s.append(p("Diretta 是严格 Source Direct：需要 Core 以 root 运行，构建时包含 Diretta SDK。"
               "严格保留无损整数 PCM 或原生 DSD（bit-perfect）；有损编码会在解码线程按原采样率/声道转为整数 PCM 播放，"
               "不声明 bit-perfect；无损浮点 PCM 会被拒绝。"))
    s.append(p("同一次连接中下一首必须保持相同 wire-format。不支持重采样、音量、EQ、变速、变调、DoP 或 DSD 转 PCM；"
               "不支持的格式会直接报错，不会降级。"))
    s.append(callout(
        "Diretta 没有声音时依次检查：输出是否选中 Diretta Target、Core 是否以 root 运行、"
        "曲目是否为无损整数 PCM 或 DSD、Target 是否被其他 Host 占用、日志中是否有 OUTPUT_FORMAT_UNSUPPORTED。"
    ))
    s.append(h2("6.3 UPnP 与 SACD"))
    s.append(p("UPnP 输出到局域网 Renderer：同一时间只支持一个 Renderer；支持常见 PCM/DSD 格式，"
               "但多声道会被拒绝；无 gapless；CUE/SACD 需要生成临时文件；Renderer 必须能访问 Core 的临时媒体端口。"))
    s.append(p("SACD DST 轨在 UPnP 下默认直通 DST 压缩 DFF：Core 只封装，不解码，起播更快、临时文件更小。"
               "Renderer 不支持 DST-DFF 时，在 <b>设置 → 播放设置 → SACD UPnP 输出</b> 切换为 DSF 兼容转码。"))
    s.append(figure(ASSETS / "settings-output.png", "图 6-1 播放设置中的输出设备与 SACD UPnP 输出：默认 DFF（DST 直通）。", max_height=235))
    s.append(p("如果设备列表为空，检查 Core 与 Renderer 是否在同一网段，以及 SSDP 多播是否被防火墙拦截。"))
    s.append(h2("6.4 输出选择速查"))
    s.append(table([
        ["目标", "建议输出", "说明"],
        ["主机直连 DAC，需要 EQ/响度/变速", "ALSA Processed", "允许样本处理；不做 ALSA 重采样"],
        ["主机直连 DAC，要求 bit-perfect", "ALSA Direct", "保留有效位；样本处理锁定"],
        ["Diretta Target，严格 Source Direct", "Diretta", "root；格式不支持会直接报错"],
        ["网络播放器或另一台音乐主机", "UPnP Renderer", "同一时间只支持一个 Renderer"],
    ], [0.36 * CONTENT_W, 0.22 * CONTENT_W, 0.42 * CONTENT_W]))
    s.append(h2("6.5 切换输出后的检查"))
    s.extend(bullets([
        "当前曲目是否重新加载，播放位置是否恢复。",
        "输出设备是否仍可用；Diretta Target 是否被其他 Host 占用。",
        "如果提示格式不支持，换歌、换输出，或改用 ALSA Processed。",
        "UPnP 下确认 Renderer 能访问 Core 的临时媒体端口；CUE/SACD 首次播放可能稍慢。",
    ]))
    return s


def chapter_07():
    s = [ChapterHeading("07", "在线音乐与媒体源")]
    s.append(h2("7.1 支持平台"))
    s.append(table([
        ["平台", "登录方式", "说明"],
        ["网易云音乐", "扫码；或手动粘贴 Cookie", "每日推荐、收藏、云盘、红心"],
        ["QQ 音乐", "QQ 扫码 / 微信扫码；或手动 Cookie", "榜单、新歌、歌单"],
        ["酷狗音乐", "扫码；或手动 Cookie", "榜单、新歌、歌单"],
        ["Qobuz", "浏览器 OAuth；或手动 token", "分区、流派、专辑"],
        ["TIDAL", "官方 PKCE 回调；设备码；或手动 token", "设备码通常只有 AAC；无损用 PKCE"],
    ], [0.18 * CONTENT_W, 0.44 * CONTENT_W, 0.38 * CONTENT_W]))
    s.append(p("Core 保存登录信息，Web 只看到「已登录/未登录」与账号名，不返回 Cookie/token。"
               "手动登录时，Cookie/token 会经过浏览器表单，再发给 Core。"))
    s.append(h2("7.2 平台首页与权益"))
    s.append(p("登录后侧边栏出现「在线平台」。平台首页包含榜单、新歌、新碟、热门歌手、推荐歌单；"
               "点击条目进入专辑/歌单/榜单/歌手详情。每日推荐、收藏、云盘需要网易云登录。"))
    s.append(p("在线歌曲可能遇到会员、数字单曲、地区/账号不可用或只有试听片段。"
               "开启「允许试听」后，只有试听源的歌曲会播放片段；试听源不会进入歌曲缓存。"))
    s.append(h2("7.3 自建媒体服务器"))
    s.append(p("支持 Subsonic、Navidrome、OpenSubsonic、Airsonic、Gonic、LMS、Jellyfin 与 Emby。"
               "在 <b>设置 → 媒体源配置</b> 新增服务器，填写名称、类型、URL、用户名与密码，"
               "测试连接后保存并设为激活；Core 会自动拉取媒体库快照。"))
    s.append(figure(ASSETS / "settings-media.png", "图 7-1 媒体源配置：添加个人流媒体服务器，配置内容加密传输。", max_height=235))
    s.append(h2("7.4 搜索"))
    s.append(p("搜索页支持本地、流媒体与在线平台三类来源；歌曲、专辑、歌手、歌单四个 tab，每页 50 条，"
               "滚动加载。切换关键词/平台/服务器会丢弃旧请求；认证失败会显示登录入口。"))
    s.append(figure(ASSETS / "search.png", "图 7-2 搜索结果：本地结果按单曲、专辑、歌手分组展示。", max_height=235))
    return s


def chapter_08():
    s = [ChapterHeading("08", "歌词")]
    s.append(h2("8.1 格式与来源"))
    s.append(p("支持 LRC、QRC、YRC、KRC、TTML、LyS、SRT、ASS，支持逐字、翻译、音译与双语显示。"
               "歌词来源包括本地文件内嵌、同名外挂、在线平台、插件与 AMLL TTML；"
               "来源与格式优先级可在 <b>设置 → 歌词设置</b> 调整。"))
    s.append(figure(ASSETS / "lyrics.png", "图 8-1 歌词区：逐行高亮、翻译与封面/歌词分栏（局部截图）。", width=330))
    s.append(h2("8.2 偏移与 TTML 歌词库"))
    s.append(p("全屏播放器歌词工具栏可以提前/延后 500ms、直接输入偏移或重置。偏移按「曲目 + 歌词源」保存，"
               "正值表示歌词提前，范围为 ±60 秒。"))
    s.append(p("设置 → 歌词设置 → 本地 TTML 可以指定 Core 主机上的目录，Core 递归扫描 .ttml，"
               "通过 AMLL 元数据（网易云/QQ ID、标题、艺术家）匹配。索引只检查根目录 mtime；"
               "在子目录新增/删除文件可能不会自动重建，可变更目录或重启 Core 触发。"))
    s.append(h2("8.3 显示与性能"))
    s.append(p("可调引擎（physics / AMLL）、字号、字重、字体、翻译、音译、逐字高亮、上浮、强调、模糊、"
               "隐藏已播放行、弹簧参数、对齐位置、渐变宽度、非激活透明度、背景歌词识别与排除关键词/正则。"))
    s.append(callout(
        "AMLL 与流体背景资源占用较高；低性能设备建议使用 physics + 模糊背景。"
        "如果歌词不显示，先检查来源顺序、格式顺序、平台登录与排除规则。"
    ))
    return s


def chapter_09():
    s = [ChapterHeading("09", "歌单、喜欢与历史")]
    s.append(h2("9.1 本地歌单"))
    s.append(p("本地歌单保存在 Core，不属于浏览器本地数据。可以新建、改名、描述、删除，添加/移除歌曲、清空；"
               "封面自动取第一首新增歌曲的封面（若歌单无封面）。"))
    s.append(h2("9.2 网易云歌单与红心"))
    s.append(p("网易云歌单需要登录：可以创建（可设隐私）、改名/描述、删除、加歌/移除、收藏/取消收藏，"
               "受账号权益与平台限制。侧边栏「我的歌单」可切换本地/在线来源，支持封面、分组、隐藏与排序。"))
    s.append(h2("9.3 播放历史"))
    s.append(p("「播放历史」是当前浏览器本地的记录：最多 500 条、去重、倒序，可删除/清空，不同步到其他设备。"
               "它和 Core 的统计是两套数据；统计页的 Top 榜会排除 streaming 来源。"))
    s.append(figure(ASSETS / "history.png", "图 9-1 播放历史：当前浏览器本地记录，不同步到其他设备。", max_height=235))
    s.append(h2("9.4 本地歌单与在线歌单"))
    s.append(table([
        ["项目", "本地歌单", "网易云歌单"],
        ["存放位置", "Core 的 data/", "网易云账号"],
        ["登录要求", "不需要", "需要网易云登录"],
        ["跨设备", "同一 Core 共享", "同一账号共享"],
        ["删除影响", "只删除 Core 中的歌单", "同时影响平台账号"],
    ], [0.22 * CONTENT_W, 0.38 * CONTENT_W, 0.40 * CONTENT_W]))
    return s


def chapter_10():
    s = [ChapterHeading("10", "下载与缓存")]
    s.append(h2("10.1 启用下载"))
    s.append(p("下载默认关闭。打开 <b>设置 → 下载配置 → 启用下载</b> 后，歌曲菜单与下载页才会出现。"
               "关闭时所有下载入口隐藏。"))
    s.append(table([
        ["设置", "说明"],
        ["下载目录", "Core 主机上的目录；默认 ~/Music/SPlayer Atom Core"],
        ["音质", "hi-res / lossless / hq / sq / lq；默认 lossless"],
        ["文件名模板", "{title} / {artist} - {title} / {title} - {artist}"],
        ["分文件夹", "不分 / 按专辑 / 按专辑+碟"],
        ["重名策略", "重命名 / 覆盖 / 跳过"],
        ["歌词与元信息", "歌词格式、内嵌封面/元信息/歌词、额外写 LRC/TTML"],
    ], [0.24 * CONTENT_W, 0.76 * CONTENT_W]))
    s.append(figure(ASSETS / "settings-download.png", "图 10-1 下载配置：目录、音质、命名、分文件夹与重名策略。", max_height=220))
    s.append(h2("10.2 下载任务"))
    s.append(p("下载页有「进行中」「失败」「已完成」三个 tab。下载串行，一次一首；同曲同音质会去重；"
               "无断点续传；临时文件在缓存目录，启动时清理。取消/删除任务不会删除已完成的音乐文件；"
               "已完成任务可以直接播放本地文件。"))
    s.append(h2("10.3 缓存"))
    s.append(table([
        ["类型", "内容", "位置"],
        ["文件缓存", "封面、歌手图、背景、歌曲缓存", "Core 缓存目录"],
        ["数据库缓存", "歌词、TTML、歌词匹配", "library.db"],
    ], [0.20 * CONTENT_W, 0.48 * CONTENT_W, 0.32 * CONTENT_W]))
    s.append(p("在 <b>设置 → 本地与缓存</b> 查看占用、分类清理、切换缓存目录或恢复默认。"
               "切换缓存目录会清空旧的文件类缓存，不会迁移；数据库缓存不受目录切换影响。"
               "歌曲缓存默认关闭，开启后可设上限（默认 10 GB）；图片缓存没有自动上限，建议定期清理。"))
    s.append(h2("10.4 缓存清理建议"))
    s.append(table([
        ["对象", "建议"],
        ["封面/歌手图/背景", "空间不足时优先清理；删除后可重新下载"],
        ["歌曲缓存", "按上限管理；关闭后不会新增缓存"],
        ["数据库缓存（歌词/TTML）", "清理后下次播放/打开歌词时重建"],
        ["缓存目录切换", "旧的文件类缓存会清空，不会迁移"],
        ["下载临时文件", "启动时自动清理；失败任务可在下载页删除"],
    ], [0.30 * CONTENT_W, 0.70 * CONTENT_W]))
    return s


def chapter_11():
    s = [ChapterHeading("11", "插件")]
    s.append(h2("11.1 安装"))
    s.append(p("设置 → 插件管理 → 从 URL 安装。只接受 HTTPS，或 http://localhost / http://127.0.0.1。"
               "安装的是插件脚本（.js）而不是压缩包。"))
    s.append(h2("11.2 类型与权限"))
    s.append(table([
        ["类型", "作用", "默认权限"],
        ["音源插件", "提供播放 URL、歌词、封面", "自动 network"],
        ["控制插件", "控制播放器、设置项、歌曲菜单", "需声明 network / control / ui"],
    ], [0.20 * CONTENT_W, 0.48 * CONTENT_W, 0.32 * CONTENT_W]))
    s.append(figure(ASSETS / "settings-plugins.png", "图 11-1 插件管理：从 URL 安装、启用/禁用、检查更新与卸载。", max_height=220))
    s.append(h2("11.3 管理与安全"))
    s.append(p("可以启用/禁用、查看状态（loading/ready/error/disabled）、配置插件设置、检查更新、一键更新与卸载"
               "（删除脚本与插件数据）。"))
    s.append(callout(
        "插件是第三方代码，可联网。只安装可信来源；插件运行在 Core 的隔离子进程，但不是强安全沙箱；"
        "一个插件长时间阻塞会拖住其他插件；host 崩溃会自动重启，超过次数后插件置 error。"
    ))
    return s


def chapter_12():
    s = [ChapterHeading("12", "统计")]
    s.append(p("统计页数据来自 Core：曲库概览（歌曲/专辑/歌手/总时长/总大小）、最近 90 天热力图、"
               "时段分布、音质构成，以及最常听歌曲/专辑/歌手。"))
    s.append(figure(ASSETS / "stats.png", "图 12-1 统计页：曲库概览、聆听足迹、播放时段、音质构成与 Top 榜。", max_height=240))
    s.append(p("Top 榜排除 streaming 来源；summary/daily/hourly 包含所有来源。播放历史是当前浏览器本地记录，"
               "与 Core 统计口径不同，两者不一致是正常的。"))
    s.append(h2("12.1 统计口径"))
    s.append(table([
        ["数据", "范围", "存放位置"],
        ["曲库概览", "歌曲、专辑、歌手、总时长、总大小", "Core"],
        ["聆听足迹 / 时段 / 音质", "最近 90 天，包含所有来源", "Core"],
        ["最常听 Top 榜", "排除 streaming 来源", "Core"],
        ["播放历史", "当前浏览器最近记录", "浏览器 IndexedDB"],
    ], [0.28 * CONTENT_W, 0.44 * CONTENT_W, 0.28 * CONTENT_W]))
    return s


def chapter_13():
    s = [ChapterHeading("13", "设置")]
    s.append(p("设置弹窗左侧是分类，右侧是内容；顶部可以搜索设置项（整页自定义分类不参与搜索）。"))
    s.append(figure(ASSETS / "settings-full.png", "图 13-1 设置：外观、播放、歌词、曲库、网络、下载、缓存、插件与其他选项。", max_height=235))
    s.append(table([
        ["分类", "主要内容"],
        ["外观设置", "语言、主题模式、主题色、背景风格、字体、布局、侧边栏"],
        ["播放设置", "自动播放、记忆进度、渐入渐出、音量均衡、削波保护、输出设备、SACD UPnP 输出"],
        ["歌词设置", "来源/格式顺序、字号、翻译、音译、逐字高亮、引擎、本地 TTML"],
        ["本地曲库", "音乐目录、增量扫描、全量重新扫描"],
        ["网络与服务", "代理、ListenBrainz、网易云打卡"],
        ["媒体源配置", "启用流媒体、添加/管理个人流媒体服务器"],
        ["下载配置", "启用下载、目录、音质、命名、分文件夹、重名策略"],
        ["本地与缓存", "文件缓存、数据库缓存、歌曲缓存上限"],
        ["插件管理", "安装、启用/禁用、更新、卸载"],
        ["其他设置 / 关于", "版本、语言、界面缩放、诊断信息"],
    ], [0.22 * CONTENT_W, 0.78 * CONTENT_W]))
    s.append(h2("13.1 推荐先设置的项"))
    s.extend(bullets([
        "第一次使用：输出设备、本地曲库目录、扫描。",
        "严格 HiFi：ALSA Direct 或 Diretta；不要期待 EQ/音量/变速可用。",
        "SACD + UPnP：先保持 DFF（DST 直通）；Renderer 不支持时再切 DSF。",
        "大曲库：开启预载下一首前先确认网络与缓存空间；图片缓存定期清理。",
    ]))
    s.append(h2("13.2 设置存放位置"))
    s.append(table([
        ["设置", "存放位置", "是否跨设备"],
        ["输出设备、播放行为、曲库、下载、插件", "Core 的 data/", "是"],
        ["主题、布局、字体、歌词显示、界面缩放", "当前浏览器", "否"],
        ["播放历史", "当前浏览器 IndexedDB", "否"],
    ], [0.55 * CONTENT_W, 0.25 * CONTENT_W, 0.20 * CONTENT_W]))
    s.append(h2("13.3 关于软件"))
    s.append(p("「关于软件」显示当前版本、构建身份与项目链接。1.3.1 的构建身份为 "
               "<b>1.3.1 / ed95ee9b / sourceDirty=false</b>；升级或排障时先核对这些信息。"))
    return s


def chapter_14():
    s = [ChapterHeading("14", "多设备与数据")]
    s.append(h2("14.1 哪些状态共享"))
    s.append(table([
        ["状态", "是否跨设备共享", "存放位置"],
        ["队列、当前曲目、循环/随机、输出设备、登录状态", "是", "Core"],
        ["主题、布局、字体、歌词显示、界面缩放", "否", "浏览器本地"],
        ["播放历史", "否", "浏览器本地（IndexedDB）"],
        ["曲库、歌单、统计、下载任务、设置", "是", "Core 的 data/"],
    ], [0.45 * CONTENT_W, 0.22 * CONTENT_W, 0.33 * CONTENT_W]))
    s.append(p("多个浏览器可以同时连接同一个 Core；关闭浏览器不会停止播放，重新打开会从 Core 恢复当前状态。"
               "如果两个设备同时操作队列，以 Core 收到的命令顺序为准。"))
    s.append(h2("14.2 数据与隐私"))
    s.extend(bullets([
        "Core 无鉴权、无 TLS；只应在可信局域网使用。",
        "凭据文件权限为 0600，但编码不是加密；备份时需要保护。",
        "Atom 不删除音乐文件；清理只涉及缓存、临时文件与未完成下载。",
        "删除 data/ 会丢失曲库索引、设置、歌单、统计与登录状态；升级前必须保留。",
    ]))
    s.append(h2("14.3 升级与迁移"))
    s.append(table([
        ["操作", "建议"],
        ["升级 Core", "保留 data/；启动后核对 /api/info 的版本与 commit"],
        ["更换主机", "先备份 data/，再在新主机安装并恢复；不要直接复制正在写入的数据库"],
        ["切换播放软件", "不要同时启用两个软件争用同一输出；先停一个再启另一个"],
        ["回滚", "保留旧安装目录或备份；data/ 的 schema 升级后不一定能被旧版本读取"],
    ], [0.24 * CONTENT_W, 0.76 * CONTENT_W]))
    return s


def chapter_15():
    s = [ChapterHeading("15", "常见问题")]
    qa = [
        ("没有声音", "确认已选择输出设备；确认设备未被其他程序独占；Diretta 检查 root、Target 占用与源格式；"
                     "UPnP 检查 Renderer 能否访问 Core 媒体端口；ALSA 用 aplay -l 查看设备；查看 Core 日志错误码。"),
        ("提示需要选择输出设备", "打开播放栏输出选择器，选择 ALSA/Diretta/UPnP 设备后重新播放。"),
        ("当前输出不支持该格式", "通常发生在 Diretta 或 Direct ALSA：源格式/采样率不受支持、下一首 wire-format 不一致、"
                                  "多声道源。换歌、换输出，或改用 Processed（会失去严格性）；Diretta 不会自动降级。"),
        ("浏览器 403", "域名未加入 ATOM_ALLOWED_HOSTS、反向代理改写 Host，或使用了 file:// / sandbox iframe。"
                       "联系管理员检查 Host/Origin 配置。"),
        ("歌词不显示", "检查来源顺序与格式顺序；在线歌词需要平台登录或网络；本地文件可能没有内嵌歌词；"
                       "可在歌曲菜单尝试匹配歌词；检查排除规则。"),
        ("下载入口不见了", "下载默认关闭；到设置 → 下载配置打开「启用下载」。"),
        ("下载很慢或失败", "下载串行、无断点续传；平台可能限速或需要权益；磁盘空间不足会失败；失败任务在下载页查看。"),
        ("插件显示 error", "查看卡片错误信息；确认脚本声明 @apiLevel 与权限；禁用后重新启用；"
                           "host 崩溃会自动重启，超过次数后需手动启用；只安装可信来源。"),
        ("曲库为空", "确认扫描目录在 Core 主机上存在且可读；确认扫描已完成；检查目录是否被移除；大库首次扫描需要时间。"),
        ("多设备状态不同步", "确认连接的是同一个 Core；刷新等待 WebSocket 重连；主题/布局/历史本来就不同步。"),
        ("统计和播放历史不一致", "统计来自 Core，历史来自当前浏览器 IndexedDB；口径与范围不同，不是同一份数据。"),
    ]
    for i, (q, a) in enumerate(qa, 1):
        s.append(h2(f"14.{i} {q}"))
        s.append(p(a))
    s.append(callout(
        "排障时先判断是哪一层：浏览器/WebSocket、Core HTTP、输出设备、在线平台或文件系统。"
        "记录时间、曲目、输出设备、错误码与 Core 日志最后 50 行，不要记录密码或 token。"
    ))
    return s


def chapter_16():
    s = [ChapterHeading("16", "附录与发布")]
    s.append(h2("16.1 目录与端口"))
    s.append(table([
        ["项目", "值"],
        ["安装根", "/opt/splayer-atom-core（可用 --prefix 覆盖）"],
        ["持久数据", "<安装根>/data/；曲库、设置、歌单、统计、登录状态"],
        ["Core HTTP/WS", "TCP 14558"],
        ["SSDP 发现", "UDP 1900（出站/组播）"],
        ["UPnP 媒体", "随机 TCP 端口（Renderer 拉流）"],
        ["Qobuz 回调", "随机本地 TCP 端口"],
        ["在线平台/插件", "出站 TCP 443"],
    ], [0.24 * CONTENT_W, 0.76 * CONTENT_W]))
    s.append(h2("16.2 常见错误码"))
    s.append(table([
        ["错误码", "含义 / 处理"],
        ["OUTPUT_DEVICE_REQUIRED", "尚未选择输出设备；打开输出选择器"],
        ["OUTPUT_FORMAT_UNSUPPORTED", "当前输出不支持该格式；换歌、换输出或改用 Processed"],
        ["UPNP_RENDERER_UNAVAILABLE", "Renderer 不可达；检查网段、SSDP 与防火墙"],
        ["LIBRARY_SCAN_RUNNING", "已有扫描任务；等待或取消后再试"],
        ["AUTH_REQUIRED", "在线平台登录失效；重新登录"],
    ], [0.36 * CONTENT_W, 0.64 * CONTENT_W]))
    s.append(h2("16.3 术语"))
    s.append(table([
        ["术语", "含义"],
        ["Core", "音乐主机上的后台服务"],
        ["Web Control", "浏览器控制界面"],
        ["Processed", "允许 EQ/响度/变速的 ALSA 输出"],
        ["Direct", "保留有效位的严格 ALSA 输出"],
        ["Source Direct", "不改变采样值/位深/声道/DSD 序列"],
        ["Gapless", "相邻曲目无缝"],
        ["CUE", "整轨镜像 + 分轨索引文件"],
        ["SACD ISO", "SACD 镜像，展开为立体声分轨"],
        ["预载", "提前解析/准备下一首"],
    ], [0.22 * CONTENT_W, 0.78 * CONTENT_W]))
    s.append(h2("16.4 发布与支持"))
    s.append(p("1.3.1 发布页：https://github.com/bnqzzdf/splayer-atom/releases/tag/v1.3.1"))
    s.append(p("仓库：https://github.com/bnqzzdf/splayer-atom"))
    s.append(p("构建身份：1.3.1 / ed95ee9b / sourceDirty=false；x86 五变体与 arm64 包均通过包闸门与真机 smoke。"))
    s.append(callout(
        "本手册是使用说明，不替代项目审计报告和发布报告。遇到安全或凭据问题，先停止服务、撤销凭据，再排查。"
    ))
    s.append(h2("16.5 版本与文档状态"))
    s.append(table([
        ["项目", "状态"],
        ["稳定版本", "1.3.1（Linux x86-64 / aarch64）"],
        ["构建身份", "ed95ee9b；sourceDirty=false"],
        ["文档版本", "v1.3.1（手册修订 v1.1；2026-11-12）"],
        ["发布资产", "x86_64 multi / aarch64 multi；含 SHA256"],
        ["文档范围", "使用说明；不含审计报告与发布报告"],
    ], [0.28 * CONTENT_W, 0.72 * CONTENT_W]))
    return s


def combine_heading_tables(story):
    combined = []
    i = 0
    while i < len(story):
        if (
            isinstance(story[i], SectionHeading)
            and i + 1 < len(story)
            and isinstance(story[i + 1], Table)
        ):
            combined.append(KeepTogether([story[i], story[i + 1]]))
            i += 2
        else:
            combined.append(story[i])
            i += 1
    return combined


def build(total_pages: int, out_path: Path):
    global TOTAL_PAGES
    TOTAL_PAGES = total_pages
    doc = ManualDoc(
        str(out_path),
        pagesize=A4,
        leftMargin=MARGIN_L,
        rightMargin=MARGIN_R,
        topMargin=MARGIN_T,
        bottomMargin=MARGIN_B,
        title="SPlayer Atom 使用手册 v1.3.1",
        author="SPlayer Atom",
        subject="SPlayer Atom 1.3.1 使用手册",
        creator="SPlayer Atom documentation",
    )
    cover_frame = Frame(0, 0, PAGE_W, PAGE_H, id="cover", leftPadding=0, rightPadding=0,
                        topPadding=0, bottomPadding=0)
    body_frame = Frame(MARGIN_L, MARGIN_B, CONTENT_W, PAGE_H - MARGIN_T - MARGIN_B,
                       id="body", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([
        PageTemplate(id="cover", frames=[cover_frame], onPage=draw_cover),
        PageTemplate(id="body", frames=[body_frame], onPage=draw_header_footer),
    ])
    story = []
    story.append(cover_page())
    story.append(NextPageTemplate("body"))
    story.append(PageBreak())
    story.extend(document_info())
    story.append(PageBreak())
    story.extend(toc_page())
    story.append(PageBreak())
    for idx, fn in enumerate([
        chapter_00, chapter_01_install, chapter_02, chapter_03, chapter_04, chapter_05,
        chapter_06, chapter_07, chapter_08, chapter_09, chapter_10, chapter_11,
        chapter_12, chapter_13, chapter_14, chapter_15, chapter_16,
    ]):
        if idx:
            story.append(CondPageBreak(210))
        story.extend(fn())
    story = combine_heading_tables(story)
    doc.multiBuild(story)


def count_pages(path: Path) -> int:
    return len(PdfReader(str(path)).pages)


def main():
    preview = ROOT / ".build-preview.pdf"
    build(0, preview)
    n = count_pages(preview)
    build(n, preview)
    n2 = count_pages(preview)
    if n2 != n:
        build(n2, preview)
        n = count_pages(preview)
    preview.replace(OUT)
    # Cleanup preview-only file if replacement left one behind
    if TMP.exists():
        TMP.unlink()
    print(f"PASS {OUT} pages={n} size={OUT.stat().st_size}")


if __name__ == "__main__":
    main()
