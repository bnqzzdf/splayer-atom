# 使用指南

SPlayer Atom 由一个 Linux x86-64 Node Core 和浏览器中的 Web Control 组成。部署 Core 后，在浏览器访问 Core 提供的 Web 页面即可使用。

## 曲库

在 **曲库** 中添加 Core 主机上的音乐目录并启动扫描。目录选择发生在 Core 文件系统上，不是浏览器本机文件选择。

支持本地曲目搜索、专辑/歌手聚合、标签编辑，以及 CUE / SACD stereo 虚拟分轨。

## 播放与队列

播放队列、当前曲目、循环/随机模式、自动下一首、错误恢复和播放进度都由 Core 持有。关闭或刷新浏览器不会把播放权威迁到 Web Control。

## 输出

可用输出统一显示在播放栏：

- ALSA
- Diretta Source Direct（构建包含 Diretta capability 时）
- UPnP Renderer

切换到 Diretta 或 UPnP 时，Web Control 会锁定不允许的 sample-processing 控件；最终约束仍由 Core/native 强制执行。

## 在线服务

Atom 正式维护 Netease、Qobuz 与 TIDAL provider。账号状态与凭据属于 Core，Web Control 只显示 token-free session projection。

自建媒体服务见 [流媒体服务](/streaming)。

## 歌词

支持 LRC、QRC、YRC、TTML 等格式，并提供翻译、音译、逐字高亮与时间偏移。歌词解析可以在 Web Control 中完成展示，但当前 Track 与播放生命周期仍由 Core 持有。

## 下载与缓存

下载目录与歌曲缓存目录都位于 Core 主机。Web Control 通过 Core Directory Picker 选择目录，不会把媒体文件下载到浏览器所在设备。

## 插件

插件运行在 Core 的隔离子进程中，可扩展音源解析与播放控制。见 [插件使用](/plugins-usage) 和 [插件开发](/plugins/)。

## 多个 Web Control

多个浏览器可以同时连接同一个 Core；它们看到的是同一份 queue/session/output 状态。不要把某个浏览器的 localStorage 当作 Core 状态备份。
