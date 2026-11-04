# SPlayer Atom 路线图

> 最后更新：2026-11-04

## 当前状态

文件夹浏览第一批改进已实现，并于 2026-09-28 完成真实曲库和浏览器下的功能验收；
这不是新的输出硬件、账号或发布验收记录。

SPlayer Atom 是一套 Linux x86-64 Core（Node 为默认正式基线、Bun 为实验 Flavor），
并以 Web Control 作为唯一 UI。Web + Core 迁移、
ALSA HW Direct / Processed 路径、Diretta Source Direct、UPnP 输出、Core 拥有的 Folder Browser、
Direct CUE 无缝路径、响应式 Web 布局以及歌词 P0/P1 实现都已进入当前代码树。Netease、QQ音乐、
酷狗、Qobuz 与 TIDAL 的 Core/Web 路径均已具备。Debian 11 bundled 包可以在带或不带 Diretta 的
情况下构建。已确认的实现里程碑见 [Atom 已完成](./atom-completed.md)。

Folder Browser 已实现分页浏览、固定目录、物理名称搜索、当前目录筛选、列表/网格展示、素材、
范围扫描、递归操作及音频/容器曲目的批量操作。列表/网格偏好已在 `058c0e63` 持久化。
[文件夹浏览改进方案](./folder-browser-improvements.md)的第一批显示排序、物理属性、Web 控件、
导航恢复、范围提示和完整结果批量选择已实现，并完成当前真实曲库的功能验收。
原方案中 NAS/USB、超大目录与素材查看器的更广验收仍待完成。

2026-11-03 至 11-04，文件夹物理路径查询与局部扫描已改为按范围读取，减少无关全库查询，
并避免在没有曲目消费者时无条件刷新整库投影（`75561bad`、`2041c17b`）。
这属于已实现的性能修正，不代表 Folder Search 延迟已在所有真实曲库上复测通过。
Node/Bun 共用 Core 源码、构建与产物验收流程，四种运行时/携带方式已可构建
（`85b5aa86`）；`mise.toml` 固定 Node `24.22.2`、Bun `1.4.4`（`0e590b43`）。
Bun 的实验基准与限制见[运行时对照](./bun-runtime-experiment.md)，尚不等同于正式发布验收。

本路线图跟踪剩余工作与验收。代码只能确立某条路径是否存在；硬件、真实账户、浏览器与发布验收
需要一次记录的运行。[2026-09-22 ALSA 记录](./alsa-acceptance-2026-09-22.md) 覆盖产物提交
`cecee166`；[2026-09-23 FC4 复测](./alsa-acceptance-2026-09-23.md) 覆盖已安装产物提交
`3e420f78` 中的两处修复。之后的 [本地模块 ALSA 复测](./alsa-gap-fixes-2026-09-23.md) 覆盖
截至 `53284360` 的源码变更；它不是已安装的 Core 产物。无硬件暂停的兜底分支为需要它的设备保留，
且仅做过软件验证。每个新产物都应以其记录的 Git 提交来标识，而不是只看包版本号。

长期约束见 `AGENTS.md`；工作流程见[开发指南](./atom-development.md)。

## 未完成工作与验收

### ALSA 与输出

- [ ] 在干净的候选 Core 产物中验证 [ALSA 输出方案](./alsa-output-plan.md) 的变更。
      [FC4 本地模块复测](./alsa-gap-fixes-2026-09-23.md) 已通过短时 Processed 变调/变速播放、
      变调/变速 seek 与 Direct 基础播放。同一源码工作树的
      [2026-09-23 native 运行态改动复核](./alsa-runtime-smoke-2026-09-23.md) 另记录了 Processed
      seek 与 Direct 基础播放的局部 smoke。在该候选上检查受支持的模式、格式、切换与资源趋势；
      若观察到具体故障再行排查。共享 `AlsaFrameWriter`、单一运行期归属以及有界解码/DSP 队列均已
      实现。各自独立的模式控制循环、参数版本跟踪，以及对单个上游解码帧的任意上限都不是验收门禁。
- [ ] 在干净候选上完成目标设备的 ALSA 格式与生命周期检查。独立的 PCM/DSD 对比已在 USB 提交层
      确立精确数据。只有在需要针对特定设备给出端到端结论时，才需要最终的 DAC bit-test 或数字
      采集；产品的软件保证止于 ALSA HW 提交边界。只有在需要声明其兜底路径已在该设备上验证时，
      才需要一台没有硬件暂停的设备。
- [ ] 在发布候选上重做 UPnP 硬件检查。2026-09-22 的 FC4 运行没有发现渲染器；更早的 AudioSys
      检查覆盖了常见格式、CUE、SACD、DSD 与输出切换。媒体监听器于 2026-09-23 通过了 100 次
      重复的终止拉取，但当前没有可用的 AudioSys Renderer。完成
      [UPnP 方案](./upnp-output-plan.md) 中第二次真实渲染器长时运行资源检查，并记录最终的兼容性矩阵。
- [ ] 完成真实 Diretta CUE 无缝验收，见
      [Direct CUE 方案](./direct-cue-gapless-plan.md)，包括相邻 PCM/DSD 段、seek、
      队列变更与长时运行的边界行为。

### Provider 与 Web Control

本轮上游界面吸收已有[分批方案](./upstream-ui-adoption-plan.md)：
AM 播放页与经典/全屏封面/AM 快捷切换（UI-1）、紧凑列表与排序隔离（UI-2）
均已实现、待浏览器验收；扫描目录嵌套和下载扩展名两个小修均已实现并通过隔离回归。
已排除项目与低频候选见方案范围，不据此勾选现有发布门禁。

- [x] UI-1 代码：AM 播放页、经典/全屏封面/AM 快捷切换、旧偏好迁移和播放控制复用；
      Node/Web 自动化、类型检查、构建与 lint 已通过，见提交 `09aa92f1`。
- [ ] UI-1 浏览器/设备验收：按方案记录各视口截图、播放连续性、歌词/队列、
      页面隐藏恢复及 Direct 模式控件。
- [x] UI-2 代码：常规/紧凑共用歌曲列表、虚拟滚动密度适配、按页面类别隔离排序偏好，
      并清理旧全局排序；具备自动化行为回归。
- [ ] UI-2 浏览器验收：长列表滚动与触底、多碟分组、定位当前曲目、移动端点击目标、
      两种密度切换及跨页面排序恢复。
- [x] FIX-1：Core 写入前拒绝嵌套扫描根目录，Web 不再通过移除目录撤销；隔离数据库测试确认曲目与歌单关联不变。
- [x] FIX-2：补充响应文件名扩展名识别，避免通用 MIME 与无后缀 URL 误写 `.mp3`；
      本地 HTTP 流测试覆盖跳过策略、歌词旁文件和临时分片清理。

- [ ] 在目标产物上，针对 [provider 验收标准](./live-provider-acceptance.md)记录 Netease、QM、KG、
      Qobuz 与 TIDAL 的完整真实账户验收。QM/KG 产品路径与 Qobuz 浏览器 OAuth/仅 token 登录均已
      实现，但本代码树没有真实账户验收运行。已有的 UPnP 记录验证了部分真实 Netease/TIDAL 在线
      路径，而不是完整的 provider 矩阵。
- [ ] 为 Now Playing、永久收听、401/429 处理、离线重试与重启补一份有界的真实 token ListenBrainz
      验收记录。当前代码实现了这些路径，但此前的完成勾选项在仓库中没有对应的运行记录。
- [ ] 在[响应式方案](./web-responsive-plan.md)中的代表性视口与实际移动设备上完成响应式
      Web Control 验收。布局已实现；仓库中没有完整的设备/交互验收记录。
- [ ] 记录多个真实 Web Control 在刷新、断开与重连情况下的长时运行使用。产物冒烟测试已通过
      多个 WebSocket 客户端与重连；这比长时运行的浏览器验收范围更窄。

### 文件夹浏览

[原方案](./local-folder-browser-plan.md)定义已实现的基础功能；
[改进方案](./folder-browser-improvements.md)记录第一批改进与后续方向。显示排序独立于 Core 拥有的目录播放顺序。

- [x] 第一批 Core 显示排序：文件名、修改时间、碟/轨号、升降序、固定分组、物理属性、分页前排序及
      排序结果变化时的游标失效校验。
- [x] 第一批 Web 排序控件和浏览器本地偏好、排序相关的历史状态、逐目录筛选恢复及确定性的返回与
      所在文件夹定位；复用列表/网格偏好持久化。
- [x] 第一批物理文件名与必要信息、递归/当前目录操作范围提示、当前筛选完整结果的全选/反选，以及
      Core 搜索截断提示。
- [x] 2026-09-28 完成当前真实曲库和浏览器下的第一批功能验收：排序、固定分组、超过 200 项的分页、
      快速切换排序、返回定位、筛选、搜索、批量选择和 CUE/SACD 容器定位均通过。最终自动化门禁
      为 Node 428/428、Web 111/111。缺少单目录超过 200 首歌曲的批量操作实机样本；Folder Search
      功能正确，但主观感觉偏慢。这两点不阻塞第一批功能验收。
- [ ] 完成原方案第 17/18 节中 NAS/USB、超大目录及素材查看器等更广的人工验收。
- [ ] 若真实曲库的 Folder Search 延迟仍明显，先测量并分析性能，再决定具体优化。
- [x] 物理路径查询、局部扫描及曲目投影刷新路径的全库操作缩减已合入 `dev`
      （`75561bad`、`2041c17b`）；仍需按真实曲库范围复测性能。
- [ ] 第二批：当前子树递归搜索、文件夹级专辑/艺术家快捷入口与批量失败提示已实现；待真实曲库和
      浏览器下完成功能验收。

### 发布

- [ ] 在实验 Bun Flavor 上分别完成目标设备 PCM/DSD、ALSA/Diretta/UPnP、切歌/seek、
      插件 Host、长期资源趋势、Debian 11/OpenRC 与升级回滚验收，再决定是否列入正式发布；
      [现有空库 API 基准](./bun-runtime-experiment.md)不能代替音频或稳定性验收。
- [ ] 从目标 Git 提交构建一个干净产物，并在同一候选上完成
      [硬件清单](./hardware-release-checklist.md)与
      [部署清单](./core-deployment.md)，包括安装、升级与回滚。`cecee166` 归档通过了文件对比与
      解包产物冒烟，但观察到的 seek/重启失败使其无法关闭最终验收。不带 Diretta 与带 SDK 150
      Diretta v3 的 Debian 11 bundled 构建于 2026-09-23 在脏工作树上通过了构建/产物冒烟；
      它们不是干净的发布候选，也不算硬件验收。v2/v4 仍可选，但本次记录中未构建。
- [ ] 上述门禁通过后，准备稳定版发布，并记录产物提交、hash、能力集与验收结果。

## 当前优先级

近期开发批次（与发布门禁并行，不自动扩大范围）：

1. 按[上游 UI 方案](./upstream-ui-adoption-plan.md)完成 UI-1、UI-2 的浏览器/设备验收；
   两批代码已实现，发布前仍需实机复核。
2. FIX-1 扫描目录嵌套和 FIX-2 下载扩展名已作为独立小修完成；实际服务部署前仍需核对构建产物。

发布前验收优先级：

1. 在同一个干净候选上验证 ALSA 行为及资源趋势，完成目标设备、UPnP 和 Diretta CUE 检查。
2. 对 Folder Browser 的 NAS/USB、超大目录、素材查看器及新版扫描/查询性能做真实曲库验收。
3. 完成五个 provider、ListenBrainz、响应式 Web、多个 Control 长时使用的验收。
4. Node 作为默认发布基线；Bun 保留为实验 Flavor，按实际目标设备验收后再评估发布。
5. 在固定候选上执行安装、升级、回滚与最终硬件检查，然后发布。

## 产品范围

当前发布面向可信家庭/局域网中的单个用户。身份认证、配对、TLS 与更严格的浏览器来源控制
需要后续通过的产品需求。

## 相关文档

| 文档                                                                                          | 用途                                |
| --------------------------------------------------------------------------------------------- | ----------------------------------- |
| [Atom 已完成](./atom-completed.md)                                                            | 已确认的实现与有界验收历史          |
| [开发指南](./atom-development.md)                                                             | 环境、检查与约定                    |
| [上游界面吸收与小修](./upstream-ui-adoption-plan.md)                                          | 待实施范围、分批顺序与验收标准      |
| [Node/Bun 运行时对照](./bun-runtime-experiment.md)                                            | 运行时 Flavor、基准与限制           |
| [构建与打包](./build-and-packaging.md)、[构建形态](./build-flavors.md)                        | Core/Web 产物与变体                 |
| [Core 部署](./core-deployment.md)                                                             | systemd、持久状态、安装、升级与回滚 |
| [GentooPlayer（OpenRC）服务管理](./gentooplayer-openrc.md)                                    | OpenRC 服务开发、部署、升级与排障   |
| [硬件清单](./hardware-release-checklist.md)                                                   | ALSA、Diretta 与 UPnP 发布检查      |
| [Provider 验收](./live-provider-acceptance.md)                                                | 真实账户验收标准                    |
| [ALSA 方案](./alsa-output-plan.md)、[UPnP 方案](./upnp-output-plan.md)                        | 输出实现与剩余检查                  |
| [Folder Browser 方案](./local-folder-browser-plan.md)、[响应式方案](./web-responsive-plan.md) | Web 功能与设备验收标准              |
| [文件夹浏览改进方案](./folder-browser-improvements.md)                                        | 显示排序、文件信息与分批验收        |
| [Direct CUE 方案](./direct-cue-gapless-plan.md)、[歌词方案](./lyric-improvements.md)          | 无缝与歌词实现                      |
