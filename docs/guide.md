# 使用指南

> 最后更新：2026-11-12

SPlayer Atom 基于 SPlayer-Next 修改，由 Linux x86-64 / aarch64 Core 和浏览器中的 Web Control 组成。Node 是默认正式运行时，Bun 是实验性 Flavor。部署 Core 后，在浏览器访问 Core 提供的页面即可使用。

## 曲库

在 **曲库** 中添加 Core 主机上的音乐目录并启动扫描。目录选择发生在 Core 文件系统上，不是浏览器本机文件选择。

支持本地曲目搜索、专辑/歌手聚合、标签编辑，以及 CUE / SACD stereo 虚拟分轨。

文件夹浏览支持分页、固定目录、物理名称搜索、当前目录筛选、列表/网格展示，以及指定范围扫描和批量操作。歌曲列表可切换常规/紧凑密度；排序偏好按页面类别分别保存，不会改变 Core 的曲库或队列顺序。

## 播放与队列

播放队列、当前曲目、循环/随机模式、自动下一首、错误恢复和播放进度都由 Core 管理。关闭或刷新浏览器不会中断 Core 中正在进行的播放。

播放页左上角可切换经典、全屏封面和 AM 三种布局。布局偏好保存在当前浏览器中，多台 Web Control 不必使用相同布局。

## 输出

可用输出统一显示在播放栏：

- ALSA
- Diretta Source Direct（构建包含 Diretta capability 时）
- UPnP Renderer

切换到 Diretta 或 UPnP 时，Web Control 会锁定不允许的 sample-processing 控件；最终约束仍由 Core/native 强制执行。

## 在线服务

Atom 已接入 Netease、QQ 音乐（QM）、酷狗（KG）、Qobuz 与 TIDAL。QM/KG 支持扫码和手动 Cookie 登录；Qobuz 支持浏览器授权，也可手动粘贴 token。Core 保存登录信息并向 Web Control 投影不含凭据的登录状态；手动登录时，输入的 Cookie 或 token 会暂时经过浏览器表单。上述平台的完整真实账号播放验收仍在[路线图](./atom-roadmap.md)中。

自建媒体服务见 [流媒体服务](./streaming.md)。

## 歌词

支持 LRC、QRC、YRC、TTML 等格式，并提供翻译、音译、逐字高亮与时间偏移。歌词解析可以在 Web Control 中完成展示，但当前 Track 与播放生命周期仍由 Core 持有。

## 下载与缓存

下载目录与歌曲缓存目录都位于 Core 主机。Web Control 通过 Core Directory Picker 选择目录，不会把媒体文件下载到浏览器所在设备。

## 插件

插件运行在 Core 的隔离子进程中，可扩展音源解析与播放控制。见 [插件使用](./plugins-usage.md) 和 [插件开发](./plugins/index.md)。

## 多个 Web Control

多个浏览器可以同时连接同一个 Core，并看到相同的播放队列、登录状态和输出设备。浏览器本地存储只用于界面设置，不是 Core 数据的备份。
