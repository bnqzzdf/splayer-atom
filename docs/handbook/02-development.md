# SPlayer Atom 开发手册

> 最后更新：2026-10-26
>
> 代码基线：`dev` 分支提交 `5693b3fc`，产品版本 `1.1.3`
>
> 读者：参与 Core、Web、原生模块、构建脚本开发的工程师

## 1. 开发模型总览

SPlayer Atom 是“一个 Core、多种客户端”的结构：

- `core/`：Node/TypeScript，持有音乐域权威；
- `src/`：Vue 3 Web Control，只发命令、消费投影；
- `shared/`：Core 与 Web 共用的协议类型与默认值；
- `native/`：Rust 原生模块，负责严格音频输出与 Qobuz/TIDAL 协议；
- `scripts/atom/`：构建、打包、发布校验；
- `docs/`：文档与文档站。

开发时最重要的两条约束：

1. **不要创建第二份业务权威。** 队列、当前曲目、循环/随机、音源解析、重试/跳过、缓存、下载、统计都只能由 Core 持有。
2. **不要绕过输出路径约束。** Diretta 与 Direct ALSA 的格式/处理限制由 native 强制执行；Web 与 Core 只能提前拒绝，不能“帮用户绕过”。

## 2. 环境准备

### 2.1 必需组件

| 组件 | 版本/说明 |
| --- | --- |
| Linux x86-64 | 原生模块只在 Linux 编译 |
| Node.js | 日常开发 `>=22.19.0`；打包必须 **24.18.0** |
| pnpm | `>=10`，仓库锁定 `11.5.2` |
| Rust | stable；CI 固定 `1.98.0` |
| ALSA 开发头 | `libasound2-dev` |
| C/C++ 工具 | `clang`、`pkg-config`；Diretta 另需 C++ 与静态 `libstdc++.a` |

Debian/Ubuntu：

```bash
sudo apt-get install --no-install-recommends -y \
  libasound2-dev pkg-config clang
```

### 2.2 安装依赖

```bash
cd /home/kele/splayer-atom-core
pnpm install
```

### 2.3 版本契约

- 运行时最低 Node：`>=22.19.0`（`core/atom/runtime/nodeRuntime.ts`）。
- 发布参考 Node：`24.18.0`。
- Core JS 的 Vite target 是 `node24`，但运行下限声明为 `22.19`。在 Node 22.19 上运行产物前，应先做一次启动烟测。
- 数据库 schema：`8`；配置 schema：`3`；Core Protocol：`1`。

## 3. 快速开始

### 3.1 启动开发环境

```bash
pnpm dev
```

该命令会：

1. 以 debug 模式构建原生模块到 `out/native`；
2. 启动 Node Core；
3. 启动 Vite Web 开发服务器。

### 3.2 开发端口注意

当前代码存在一个**默认端口不一致**：

- Core 默认端口 `14558`；
- Vite 代理默认指向 `14558`；
- Web 开发态客户端硬编码访问 `14559`（`src/core/controlClient.ts`、`src/core/controlEventClient.ts`）；
- `scripts/dev.ts` 没有设置 `ATOM_SERVER_PORT`。

因此按仓库默认值直接 `pnpm dev` 时，前端可能连不上 Core。开发时可显式指定：

```bash
ATOM_SERVER_PORT=14559 pnpm dev
```

或在不改代码的前提下统一代理与客户端端口。若修改该行为，应同时更新 `scripts/dev.ts`、`vite.config.ts`、`src/core/controlClient.ts`、`src/core/controlEventClient.ts` 与测试。

### 3.3 第一次构建

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

`pnpm build` 顺序为：native → typecheck → Core → Web。

## 4. 仓库结构

```text
core/
  atom/             Core 运行时、控制路由、文件夹路由、UPnP、Direct 输入
  apis/             网易云/QQ/酷狗/Qobuz/TIDAL 协议适配
  core-node/        Core 入口
  database/         SQLite schema、迁移、查询
  plugins/          插件 registry、host、沙箱、存储
  server/           Hono HTTP、WS、广播、请求守卫
  services/         播放会话、音源解析、缓存、下载、扫描、歌词、统计等
  store/            设置存储与迁移
  utils/            日志、路径、时间、文件名等
shared/
  types/            Core/Web 共用协议类型
  defaults/         默认设置、插件 API 默认值
  constants/        Core Protocol
  utils/            共享纯函数
src/
  core/             Core HTTP/WS 客户端、事件投影
  stores/           Pinia 状态
  pages/            页面
  components/       组件
  services/         歌词、下载、播放时间、平台首页等
  settings/         设置 schema 与分类
native/
  audio-engine/     N-API 包装
  audio-engine-core 解码、ALSA、Diretta、CUE/SACD
  streaming-api/    Qobuz/TIDAL
  diretta-sys/      Diretta SDK FFI
scripts/atom/       构建、打包、发布检查
docs/               文档
```

`@main/*` → `core/`，`@shared/*` → `shared/`，`@/*` → `src/`。

## 5. 运行架构

### 5.1 进程与线程

| 边界 | 形态 | 说明 |
| --- | --- | --- |
| Core 主进程 | Node 单进程 | HTTP/WS、SQLite、业务状态、NAPI 调用 |
| audio-engine | 同进程 NAPI | Rust 解码/输出线程、位置定时器、事件回 JS |
| streaming-api | 同进程 NAPI | tokio + reqwest，只做协议调用 |
| plugin-host | fork 子进程 | 所有启用插件共享，每插件一个 vm context |
| ListenBrainz child | fork 子进程 | 仅启用时创建；独立 SQLite outbox |
| UPnP 媒体服务 | 主进程内 HTTP server | 临时端口，空闲自动关闭 |
| Web Control | 浏览器进程 | HTTP/WS 客户端 |

### 5.2 Core 启动顺序

```text
校验 Node 版本
→ 设置默认环境变量
→ 预检/迁移数据 schema（在加载 store/database 之前）
→ 初始化日志、数据库、歌曲缓存、插件 registry
→ 注册插件控制事件
→ 初始化 ListenBrainz 子进程（仅启用时）
→ 注册播放器事件
→ 初始化下载管理器
→ 初始化播放会话（首次创建 player）
→ 启动 HTTP/WS
→ 异步恢复流媒体服务器连接
```

关键顺序：

- 数据迁移必须先于 store/database 导入，否则可能用新代码读旧 schema。
- 播放器事件必须在首次 `getPlayer()` 之前注册。
- `startServer()` 失败时 Core 以非零码退出。

### 5.3 关闭行为

当前 SIGTERM/SIGINT 只做 `store.flushImmediate()`，然后 `process.exit`。播放、下载、UPnP 媒体服务、插件 host、ListenBrainz child、Direct 临时文件不保证优雅清理。开发新功能时不要假设存在全局 shutdown 钩子；如需要，先补统一的关闭编排并加测试。

## 6. Core 开发指南

### 6.1 扩展 HTTP 接口

标准步骤：

1. **共享类型**：若请求/响应跨 Core/Web，先在 `shared/types/` 定义或扩展类型。
2. **服务层**：在 `core/services/` 实现业务，不要在路由里写业务逻辑。
3. **路由**：在 `core/atom/headless/routes.ts` 或对应模块注册；使用现有 `commandError` / 校验风格。
4. **Control 客户端**：在 `src/core/*Client.ts` 增加调用，保持 URL 与类型一致。
5. **状态投影**：若变更权威状态，发布事件与快照；不要只改本地 store。
6. **测试**：至少覆盖服务行为 + 路由/调用点（见第 10 节 R5）。

路由约定：

- 绝大多数命令成功返回 `{ ok: true }` 或完整快照；
- 校验失败返回 `400 { error }`；
- 样本处理不可用返回 `409 { error: "output_processing_unavailable" }`；
- 不要新增未经鉴权的“任意文件读写/任意命令执行”接口；
- 新接口必须考虑 Host/Origin 守卫与路径边界。

### 6.2 播放会话不变量

`core/services/playbackSession.ts` 是唯一播放权威。修改时保持以下不变量：

1. **先收敛 preload 再完整加载**：`waitForPlaybackPreloadIdle()` 之后再 `loadIndex()`。
2. **必须已选择输出**：否则 `OUTPUT_DEVICE_REQUIRED`。
3. **generation 校验**：异步 resolve/load 完成后检查 `generation !== loadGeneration`，丢弃过期结果。
4. **NowPlaying 先提交，session 后 publish**：这样 Control 漏掉 `trackLoaded` 也能用 `/now-playing` 与 session 恢复。
5. **只通过 `playbackSourceResolver` 解析音源**：不要在路由或 UI 里拼播放 URL。
6. **Direct/UPnP 不允许样本处理**：`assertSampleProcessingAvailable()` 是统一门禁。
7. **输出切换是事务**：记录旧状态 → 停旧输出 → 选新输出 → 重载 → 恢复位置/意图 → 失败回滚。
8. **预载 key 必须覆盖所有影响输入的策略**：queueIndex、track identity、CUE 边界、songLevel、trial、outputDevice、alsaMode。
9. **失败策略有界**：最多 `min(5, 队列长度)` 次；设备/未知错误不跳过。
10. **不要持有第二份队列**：Web store 只是投影。

### 6.3 音源解析链

`playbackSourceResolver.ts` 的顺序：

```text
local → cache → streaming → netease → qobuz/tidal → qqmusic/kugou
```

平台内部：

- 网易云：官方 `song_url` → 插件兜底；试听/权益错误分类。
- QQ/酷狗：Core 原生 URL → 插件兜底；原生给出权益类精确原因时保留原生错误。
- Qobuz/TIDAL：Rust `streaming-api`，无 JS fallback。
- 流媒体服务器：adapter `getStreamUrl`，即时获取，不存库。

新增音源时：

- 在 `shared/types/player.ts` 的 `TrackSource` 中扩展；
- 在 resolver 中增加分支；
- 在 `playbackSourcePolicy` 中定义可跳过错误与缓存 key；
- 在 Web 的 `source` 处理、搜索、合集/歌手页补投影；
- 不要绕过 `Track` canonical 结构。

### 6.4 错误与跳过策略

- 错误码统一定义在 `shared/types/errors.ts`。
- `playerLoad.ts` 把 native 错误分类为 `LOAD_SUPERSEDED`、`DEVICE_NOT_FOUND`、`FILE_NOT_FOUND`、`OUTPUT_FORMAT_UNSUPPORTED`、`NETWORK_ERROR`、`FILE_DECODE_ERROR`。
- 可跳过集合在 `playbackSourcePolicy.ts`；设备类与未知错误不可跳过。
- 在线源 `sourceError` 只允许一次 fresh resolve；失败后前进。
- 新增错误码时同步 i18n `errors.{code}` 与前端 `handleError()` 行为。

### 6.5 设置权威

Core 设置与浏览器本地设置分离：

- **Core 持有**：`player.*`、`library.*`、`lyric.*`、`localLyric.*`、`cache.*`、`download.*`、`streaming.enabled`、`listenbrainz.*`、`system.networkProxy.*`、`system.neteaseRealIp`、`system.neteaseScrobble*`。
- **浏览器本地**：主题、语言、布局、字体、歌词显示参数、界面缩放、引导完成标记等显示偏好。
- **专用端点**：`player.outputDevice`、`player.volume`、`player.lyricOffsets`、`cache.dir`、`download.dir` 不走通用 settings mutation。
- 通用 mutation 只校验路径前缀，不校验 value schema；新增设置项时应在前端与 Core 两侧都做范围/类型约束。

### 6.6 数据库与迁移

数据库：`data/database/library.db`，WAL 模式。当前 schema `8`。

新增表/列：

1. 在 `core/database/index.ts` 的建表/补列逻辑中体现。
2. 在 `core/database/migration.ts` 增加 `targetVersion → targetVersion+1` 的事务步骤。
3. 更新 `DATABASE_SCHEMA_VERSION`。
4. 考虑旧数据回填、指纹失效、缓存重建。
5. 加迁移测试：旧 schema → 新 schema、数据保留、版本拒绝。
6. 不要通过删除数据库绕过迁移；启动前会拒绝高于支持版本的 schema。

迁移备份：

- 仅当既有 DB/config 需要升级时创建；
- DB 用 `VACUUM INTO`，config 目录递归复制；
- 位置 `data/backups/migration-*`；
- 备份不会自动清理。

### 6.7 缓存与下载

- 歌曲缓存键由 `playbackSourcePolicy` 统一生成；不要在别处拼 key。
- 缓存写入必须 `.part` → rename；并做 MIME/大小/首字节弱校验。
- 缓存命中要校验文件存在；缺失则删行。
- LRU 淘汰只在成功写入后触发。
- 下载串行；同 taskId、同 `source:id:quality` 去重；下载前才 resolve URL。
- 下载临时文件放 `<cache>/downloads-tmp`，与用户下载目录隔离。
- 删除只允许 Atom 自有文件；不要删除已完成的用户媒体。

### 6.8 插件

- 插件脚本由 `core/plugins/loader.ts` 解析头部；manifest 落盘 `plugins/manifest.json`。
- 插件执行在 host 子进程的 vm context；宿主通过 `dispatchHostCall` 做权限门控。
- 新增插件 API 时：
  - 提升 `@apiLevel`；
  - 更新 `shared/types/plugin.ts`；
  - 更新 `docs/plugins/` 与 API 文档；
  - 在 host 与 registry 两侧加权限/参数校验；
  - 加负向测试（无权限必须失败）。
- 当前 `events` / `splayer.player.on` 是协议保留，Core 不下发播放事件；不要在新插件里依赖。

### 6.9 ListenBrainz

- 禁用时不得创建 child、不得启动定时器、不得发 HTTP。
- 达到阈值才生成 captureId；child 持久化回 `captured` 后才删除父进程的未确认记录。
- 重试状态机在 child：2xx 删除、401 `auth_error`、408/429/5xx 退避、其他 4xx `dead`。
- 不要把 SQLite/HTTP 放回 Core 主进程。

## 7. Web 开发指南

### 7.1 技术栈与入口

- Vue 3 + Vue Router 5 + Pinia 4 + vue-i18n 11。
- Hash history；页面懒加载。
- `src/main.ts`：`/debug` 挂 `HeadlessApp`，正常路径挂 `App.vue`。
- `src/layouts/MainLayout.vue`：侧栏/顶栏/播放栏/全局弹层。
- Vite 自动导入 Vue/Pinia/Router/VueUse/i18n；`src/components` 自动注册。

### 7.2 页面清单

| 路径 | 页面 | 用途 |
| --- | --- | --- |
| `/onboarding` | Onboarding | 四步引导 |
| `/` | Home | 问候、统计、推荐 |
| `/platforms` | PlatformHome | 已登录在线平台首页 |
| `/platforms/:platform/section/:section` | PlatformSection | 平台分区 |
| `/songs` | Songs | 本地歌曲 |
| `/liked` | Liked | 本地/网易云红心 |
| `/history` | History | 浏览器本地播放历史 |
| `/download` | Download | 下载任务 |
| `/daily` | Daily | 网易云每日推荐 |
| `/favorites` | Favorites | 网易云收藏 |
| `/cloud` | Cloud | 网易云云盘 |
| `/collection/:source/:type/:id` | Collection | 专辑/歌单/榜单/云盘详情 |
| `/artist/:source/:id` | Artist | 歌手详情 |
| `/artists/local` | LocalList | 本地歌手 |
| `/albums/local` | LocalList | 本地专辑 |
| `/folders` | Folders | Core 文件系统浏览 |
| `/stats` | Stats | 播放统计 |
| `/search` | Search | 本地/流媒体/在线搜索 |
| `/streaming/*` | Streaming | 自建媒体服务器浏览 |
| `/debug` | HeadlessApp | 工程诊断页 |

### 7.3 状态管理

| Store | 职责 | 持久化 |
| --- | --- | --- |
| `settings` | 语言、外观、播放器本地偏好、Core settings 快照 | localStorage（omit `system`） |
| `theme` | 明暗、色源、背景、封面取色 | localStorage |
| `status` | 播放状态、进度、音量、输出、循环/随机、FM、AB 循环 | localStorage 部分字段 |
| `queue` | Core session 的队列投影 | 否 |
| `media` | 当前 Track/详情/歌词/偏移 | 否 |
| `library` | 本地曲目、扫描目录/进度、红心、聚合 | localforage |
| `playlist` | 本地歌单 CRUD | Core + 旧数据 localforage |
| `user` | 网易云账号资料与内容 | localStorage + IndexedDB |
| `data` | 搜索历史、平台资料、每日推荐归档 | localStorage + IndexedDB |
| `history` | 浏览器播放历史（500 条） | IndexedDB |
| `streaming` | 媒体服务器列表、连接、内存曲库 | 否 |
| `download` | 下载任务镜像 | 否 |
| `plugins` | 插件列表与状态 | 否 |
| `providerSessions` | 五个平台登录态投影 | 否 |
| `coreCapabilities` | `/api/info` 能力位 | 否 |

### 7.4 Core 连接与事件

- `src/core/controlClient.ts`：
  - 生产 `location.origin`，开发 `hostname:14559`；
  - 请求前校验 `/api/info.protocol`；
  - 非 2xx 读取 JSON `error`。
- `src/core/controlEventClient.ts`：
  - 单例 WebSocket，多订阅者共享；
  - 连接后拉 `/session` 与 `/status`，合成 `session`/`status`/`deviceChanged`；
  - 每 500ms 轮询 `/api/status`（页面可见时）；
  - 断线 1 秒后重连；协议不兼容不重连。
- 事件到 UI 的映射在 `src/core/player/events.ts`。
- 资源 URL 投影在 `src/core/controlAssets.ts`：`cache://` → `/cache/...`，`streaming-cover://` → `/api/streaming/cover`。

新增事件时：

1. 在 `shared/types/coreEvents.ts` 加类型；
2. Core 侧 `publishCoreControlEvent()`；
3. Web 侧 `controlEventClient` 映射资源 URL；
4. `events.ts` 或对应 store 处理；
5. 加协议测试与客户端测试。

### 7.5 设置页面

- 设置分类在 `src/settings/categories/*.ts`，汇总在 `src/settings/schema.ts`。
- 注意：分类里的 `defaultValue` **不参与渲染**；实际默认值在 `src/stores/settings.ts` 与 `shared/defaults/settings.ts`。二者曾出现不一致，新增设置时以实际 store 默认值为准，并保持一致。
- Core 设置通过 `settingsClient` 读写；本地设置直接改 store。
- 自定义面板放在 `src/components/settings/custom/`。
- i18n 约定：`settings.{key}.label`、`settings.{key}.description`、`settings.group.{category}`。

### 7.6 组件与样式约定

- 自研 UI 原语在 `src/components/ui/`，统一 `S*` 前缀。
- 使用 UnoCSS 主题变量，不硬编码颜色。
- 页面若加入 `KeepAlive` 白名单，必须显式 `defineOptions({ name })`。
- 业务动作统一用 `ControlAction` 模型，菜单/右键/长按共享语义。
- 注释遵循 AGENTS：中文、只解释非显而易见的“为什么”。

### 7.7 响应式与本地化

- 断点：`<768` 手机、`768–1279` 平板、`>=1280` 桌面。
- 手机使用抽屉导航、固定底部播放栏、全屏设置。
- 语言：`zh-CN` / `en-US`，默认中文，fallback 英文。
- 新增文案必须同时补 `zh-CN.json` 与 `en-US.json`；避免硬编码中文。

## 8. Native 开发指南

### 8.1 crate 结构

| crate | 作用 |
| --- | --- |
| `native/audio-engine` | N-API 薄包装：player、scanner、tags、extraction |
| `native/audio-engine-core` | 解码、ALSA、Direct PCM/DSD、Diretta、CUE/SACD、DSP |
| `native/streaming-api` | Qobuz/TIDAL 协议 |
| `native/diretta-sys` | Diretta SDK C++ bridge |

### 8.2 构建

```bash
pnpm build:native          # release
pnpm build:native --dev    # debug
cargo check --workspace
cargo test --workspace
cargo clippy --workspace --all-targets
```

原生构建会检查：

- `audio-engine.node` 不得动态依赖 `libpipewire*` / `libpulse*`；
- `streaming-api.node` 不得动态依赖 `libssl.so` / `libcrypto.so`。

### 8.3 Diretta 约束

修改 Direct/Diretta 代码时必须保持：

1. 严格 PCM 只接受 lossless integer source；
2. staged 与当前 connection 的 rate/channels/valid_bits/storage_bits/sample_format 完全一致；
3. PCM ↔ Native DSD 不同 runtime 切换；
4. DSD 不做 DoP/DSD2PCM/bit reversal 以外的处理；
5. 实时回调不分配、不加锁、不写日志、不发现/协商；
6. 失败信息明确，不静默回退。

新增格式支持时，先加源码级测试与负向测试，再做硬件验收。

### 8.4 N-API 接口

- 类型声明在 `native/audio-engine/index.d.ts`；新增方法时同步更新。
- Core 侧通过 `core/services/engine.ts` 单例访问；不要在别处直接 `require` addon。
- 原生错误应保留可分类信息，Core 在 `playerLoad.ts` 转成 `ErrorCode`。

## 9. 数据与配置

### 9.1 配置存储

- `settings.json`：`deepMerge(defaultSystemConfig, raw)` 补默认值；200ms 防抖原子写。
- 新安装直接把 `__configVersion` 设为当前，不跑迁移。
- 配置版本高于当前支持 → 拒绝启动。
- 迁移在 `core/store/migrations.ts`。

### 9.2 路径

| 环境 | 数据根 | 缓存根 |
| --- | --- | --- |
| 打包 | `<安装根>/data` | `$XDG_CACHE_HOME/splayer-atom` 或 `~/.cache/splayer-atom` |
| 开发 | `$XDG_DATA_HOME/splayer-atom/app-data` | 同上 |

`ATOM_DATA_DIR` 可覆盖数据根；改变它不会自动迁移旧数据。

## 10. 测试策略

### 10.1 命令

```bash
pnpm typecheck
pnpm lint
pnpm test              # Node test + Vitest
pnpm test:native       # cargo test --workspace
pnpm test:all
```

### 10.2 分层

| 层 | 位置 | 关注点 |
| --- | --- | --- |
| Core 单元/服务 | `core/**/*.test.ts` | 状态机、策略、迁移、路由契约 |
| Web 单元/组件 | `src/**/*.spec.ts` | client URL/请求体、store、composable、页面契约 |
| Native | `native/**/src/**` 内联测试 | Direct 格式、CUE 换算、Diretta 回调、DSD |
| 产物 smoke | `scripts/atom/check-core-artifact.ts` | 启动、HTTP/WS、重启持久化、SIGTERM |
| 硬件验收 | `pnpm check:hardware-release` | 真实 ALSA/Diretta/UPnP |

### 10.3 工程纪律 R5：覆盖调用点

“返回结构 + 调用点消费”的改动，断言必须同时覆盖调用点。例如：

- 新增 API 返回字段：测试路由响应，同时测试前端 client 的解析与 store 消费；
- 新增设置：测试 Core 写入，同时测试设置面板的显示/禁用条件；
- 新增错误码：测试服务抛出，同时测试 `handleError()` 的展示。

### 10.4 工程纪律 R6：负对照

新断言脚本必须先在**没有补丁的代码**上跑出红，再在有补丁的代码上跑绿。否则无法证明断言真的覆盖了目标行为。

### 10.5 测试数据

- 不提交真实账号、Cookie、token、播放 URL、私有路径。
- 硬件/在线验收记录必须脱敏。
- 测试夹具放在 `core/services/fixtures/` 或对应目录，避免依赖外部网络。

## 11. 构建与打包

### 11.1 常用命令

| 目标 | 命令 |
| --- | --- |
| 全量构建 | `pnpm build` |
| 仅 native | `pnpm build:native` |
| 仅 Core | `pnpm build:core` |
| 仅 Web | `pnpm build:web` |
| system 包 | `pnpm package:core` |
| bundled 包 | `pnpm package:core:bundled` |
| Debian 11 包 | `pnpm package:core:debian11 --without-diretta` |
| Diretta 本机包 | `DIRETTA_SDK_ROOT=... pnpm package:core:diretta` |
| 源码包 | `pnpm package:source` |
| 发布标签 | `pnpm release:tag --dry-run` / `pnpm release:tag --push` |
| 硬件验收 | `pnpm check:hardware-release -- --artifact <tar.gz>` |
| 文档时间戳 | `pnpm docs:stamp` / `pnpm docs:stamp:check` |
| 文档站 | `pnpm docs:build` |

### 11.2 打包前置

- 打包脚本要求 Node **24.18.0**（system 与 bundled 都一样）。
- 默认发布构建要求提交已推送到网络远端且工作树干净。
- 本地试验可用 `--allow-unpublished`，但产物仍标记未发布身份。
- Diretta 构建要求 `DIRETTA_SDK_ROOT` 指向 SDK 150，且选择 `v2|v3|v4|zen4`。

### 11.3 产物

```text
out/
  native/                 audio-engine.node、streaming-api.node、build.json
  core/                   index.js、plugin-host.js、listenbrainz-child.js
  renderer/               Web Control
  core-system/            安装根暂存
  splayer-atom-core-...tar.gz
```

产物名：

```text
splayer-atom-core-<version>-<8位commit>-<YYYYMMDD>-<HHMMSS>[-diretta-<variant>]-<system|bundled>-linux-x64.tar.gz
```

`runtime.json` 是发布身份与运行契约的权威记录；`native/build.json` 是原生构建身份。

### 11.4 可复现性

- `ATOM_BUILD_DATE` 固定日期、`ATOM_BUILD_TIME` 固定时间可复现内容与文件名。
- tar 使用 `--sort=name --mtime=@<打包日零点> --owner=0 --group=0 --numeric-owner`。
- 源码包用 `git archive <commit>`，不是当前工作树。

### 11.5 Debian 11

普通 `pnpm package:core` 不检查 glibc；若目标机是 Debian 11，必须使用：

```bash
pnpm package:core:debian11 --without-diretta
# 或
DIRETTA_SDK_ROOT=/path/to/SDK \
  pnpm package:core:debian11 --with-diretta --diretta-variant=v3
```

容器构建会检查三个原生模块的最高 glibc 符号不超过 2.31，并复核 Diretta 变体一致性。

### 11.6 CI

`.github/workflows/dev.yml` 在 push 到 `dev` 时执行：

```text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
cargo clippy --workspace --all-targets
pnpm test:native
pnpm build
pnpm package:core
upload system-runtime artifact
```

CI 不构建 bundled/Debian/Diretta，不做 glibc 门禁，不发布 Release。发布前需手工补齐。

## 12. 工程实施纪律（R1～R10）

仓库 `AGENTS.md` 的 R1～R10 对所有代码变更、构建、部署与调试生效。开发时必须遵守：

| 规则 | 要点 |
| --- | --- |
| R1 | 先交付环境可判定性：前提清单、体检脚本、基线、开机自检；双向结论、只读、进构建闸门 |
| R1.1 | 已有项目在下一次代码变更前必须补建体检件；使用 `~/engineering-standards/envcheck` 通用引擎 |
| R1.2 | 在 `ENGINEERING-PROJECTS.md` 登记体检状态：`已建` / `待建` / `不适用` |
| R2 | 断言全绿 → 构建 → 安装；结构断言在剥离注释/字符串后的代码上做 |
| R3 | 同一缺陷第 3 次重现，转成断言或抽象 |
| R4 | 同型返回值用具名结构，禁止裸元组解包 |
| R5 | 单测覆盖调用点，不只测函数本身 |
| R6 | 新断言脚本先做负对照（无补丁跑红） |
| R7 | 诊断/体检/探针必须只读，注释列禁止 API，断言逐条禁止，并有实测记录 |
| R8 | 结论文案必须能被证据支撑；不能把“无法判定”写成“正常” |
| R9 | 变更前工作区必须干净；坏改动先回退再重做 |
| R10 | 交付文档写清“环境 vs 代码”的现象边界与处置步骤 |

本项目的环境体检件登记在 engineering-standards 仓库的 `envcheck/specs/splayer-atom-core.yml`。**任何代码变更前**先跑一次体检并记录结论；纯文档变更不需要。

## 13. 调试与诊断

### 13.1 日志

- Core 日志走 stdout/stderr，作用域前缀 `[core]`、`[player]`、`[server]` 等。
- 没有文件日志、没有访问日志、没有结构化字段。
- native tracing 未被 Core 初始化；不要依赖 `data/logs/audio-engine-*.log`。
- 插件 `console.*` 汇入 Core stdout，不是单独文件。
- systemd：`journalctl -u splayer-atom-core`。
- OpenRC：`/var/log/splayer-atom-core.log`、`.err.log`。

### 13.2 常用探针

```bash
curl -s http://127.0.0.1:14558/api/info
curl -s http://127.0.0.1:14558/api/status
curl -s http://127.0.0.1:14558/api/session
curl -s http://127.0.0.1:14558/api/output/devices
curl -s http://127.0.0.1:14558/api/cache/stats
```

这些是只读 GET；不要用 `POST /api/output/select` 或播放命令做“探测”，那会改变系统状态。

### 13.3 播放问题定位顺序

1. `/api/info`：版本、commit、capabilities、Diretta 是否编译。
2. `/api/output/devices`：目标设备是否存在、选中项是什么。
3. `/api/session`：队列、索引、repeat/shuffle。
4. `/api/status`：state、position、output.path、sampleProcessingAvailable。
5. Core 日志：`playerLog.error(code, error)`。
6. 若 `OUTPUT_FORMAT_UNSUPPORTED`：确认输出路径与源格式；Diretta 不会回退。

### 13.4 Web 问题定位

- 浏览器 DevTools Network：`/api/*` 状态码与响应体；`/ws` 是否 101。
- 协议不兼容：`CORE_PROTOCOL_UNSUPPORTED`，不会自动重连。
- 403：Host/Origin 守卫；检查 `Host`、`Origin`、`ATOM_ALLOWED_HOSTS`、反向代理。
- 进度不动：WS 不推 `position`，确认 `/api/status` 500ms 轮询是否成功。
- 设置不生效：确认该键属于 Core 还是浏览器本地；专用路径走各自端点。

## 14. 常见开发陷阱

| 陷阱 | 事实 | 处理 |
| --- | --- | --- |
| 开发端口不一致 | 前端 dev 固定 14559，Core 默认 14558 | `ATOM_SERVER_PORT=14559 pnpm dev` |
| `PATCH /session/queue/tracks` 不可达 | 被 `/:index` 路由遮蔽 | 改用逐项更新或替换队列 |
| 设置 `defaultValue` 不生效 | `SettingsItem.vue` 不读取分类默认值 | 以 store/shared defaults 为准 |
| capability 被当成鉴权 | 服务端不按 capability 拒绝路由 | 只用于 UI 隐藏 |
| `remoteOutput` 恒 false | 尽管 UPnP 已实现 | 不要用它判断 UPnP 可用性 |
| 插件事件未下发 | `events`/`player.on` 仅协议保留 | 不要依赖 |
| 日志目录不存在 | `data/logs` 无写入者 | 看 stdout/journald |
| 迁移后旧二进制读新数据 | schema 只向前兼容 | 回滚用完整旧安装 |
| 下载/缓存弱校验 | 只查 MIME/大小/首字节 | 解码失败要 invalidate |
| 修改 `settings.json` 结构 | 需要迁移与版本 | 按第 9 节流程 |

## 15. 提交与发布流程

### 15.1 提交

- 使用 Conventional Commits，标题配一行中文摘要：`<type>: <summary>`。
- 正文仅在明确要求时添加。
- 不格式化/改写无关脏文件。
- 提交前：`git diff --check`、相关门禁。
- 工作区必须干净再开始新改动（R9）。

### 15.2 发布

1. 确认工作树干净、提交已推送到网络远端。
2. 运行完整门禁：`pnpm typecheck && pnpm lint && pnpm test && pnpm test:native`。
3. `pnpm build`。
4. 选择产物形态：system / bundled / Debian 11 / Diretta。
5. 运行 `check-core-artifact` 与 `check-hardware-release`（只读模式）。
6. 记录 `runtime.json`、产物 sha256、capability 与验收结果。
7. `pnpm release:tag --dry-run` 检查，再 `--push`。

### 15.3 文档

- 修改行为时同步更新 `docs/`、本手册与 API 文档。
- `pnpm docs:stamp` 更新“最后更新”，`pnpm docs:stamp:check` 作为门禁。
- 文档必须写清环境与代码的边界（R10）。

## 16. 参考

- [项目书](./01-project.md)
- [运维手册](./03-operations.md)
- [程序接口文档](./05-api.md)
- [开发环境（既有）](../atom-development.md)
- [构建与打包](../build-and-packaging.md)
- [原生模块](../native.md)
- [插件开发](../plugins/)
- [路线图](../atom-roadmap.md)
- `AGENTS.md`（项目约束与 R1～R10）
