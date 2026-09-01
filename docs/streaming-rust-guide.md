# Qobuz / TIDAL Rust Protocol Engine Guide

`native/streaming-api` 是 Atom 正式 Node Core 使用的 Qobuz / TIDAL **唯一平台协议实现**。它不是第二个 Core，也不是独立 Headless 产品：Node Core 仍然持有 provider session、用户凭据持久化、Core event、Track/domain normalization、播放策略、cache 与 recovery；Rust 只负责平台协议、认证流程、签名、请求/响应解析和播放源解析。

正式调用关系：

```text
Web / Desktop Control
        -> Node Core providerApi
        -> qobuz/index.ts | tidal/index.ts
        -> streaming-api.node
        -> native/streaming-api
        -> Qobuz / TIDAL
```

不要恢复 TypeScript HTTP/signature/DASH fallback，不要让 Rust provider 自己建立第二套 account/session database。

---

## 1. Qobuz

### 1.1 签名与 Query / Header 边界

`track/getFileUrl` 使用 MD5 request signature：

```text
request_sig = md5(object + method + sorted_business_params + request_ts + working_secret)
```

签名输入只包含平台要求的业务参数。`app_id`、`user_auth_token`、`request_ts`、`request_sig` 不得错误混入业务参数排序。认证信息按当前已验证实现使用 Qobuz 要求的 header/query 位置；修改前必须以 `native/streaming-api` 的确定性签名向量和真实账号验收为准。

关键回归测试位于 Rust crate，至少覆盖：

- 固定 `track/getFileUrl` 签名向量；
- Web Player versioned bundle 定位；
- seed / timezone / info / extras 的 secret candidate 派生；
- 未知 action 在网络请求前明确拒绝。

### 1.2 App credential discovery

Qobuz Web Player bundle 会随版本变化，不能依赖固定 bundle URL。正式实现按已验证的 Web Player Bundle 路径动态发现 app id / initialization secret candidate，并将成功结果只缓存在当前进程内。

约束：

- 不读取 `~/.config/qobuz-dl`；
- 不要求安装 `qobuz-dl`；
- 自动发现的 app secret 不写入 Atom 配置或数据库；
- 显式 `QOBUZ_APP_ID` / `QOBUZ_APP_SECRET` 可作为运行环境覆盖；
- 动态发现失败时只能使用仓库中经过测试验证的兼容参数，不从任意 bundle 字符串猜 secret。

### 1.3 用户登录态归 Node Core

Rust `QobuzClient` 可以在一次调用中持有 `user_auth_token` / `user_id`，但它们来自 Node Core 注入。长期持久化和 token-free session projection 由 `electron/main/apis/qobuz/auth.ts` 管理。

```text
Node Core SecretStore/session
        -> per-call auth context
        -> Rust QobuzClient
        -> remote API
```

Rust 不创建独立 account store，不发布 Core provider session event。

### 1.4 播放源

`track_getFileUrl` / `song_url` 的平台协议只在 Rust 中实现。Rust 返回平台结果，Node 的薄 adapter 将其规范化为既有 Core contract；最终 quality policy、cache key、materialization 与 playback recovery 仍由 Core `PlaybackSourceResolver` 决定。

---

## 2. TIDAL

### 2.1 Client credential / redirect

正式实现复用 atom-base 已完成真实接入验证的 TIDAL client credential / redirect 参数。除显式环境覆盖外，这些参数属于 `native/streaming-api` 协议实现的一部分；不要在 Node/Control 再复制第二套常量或 auth flow。

Node Core 只持久化用户态信息，例如 access token、refresh token、user id、country code 以及为后续 refresh 所需的 session context。平台 Authorization Code / PKCE、Device Code、token exchange 与 refresh 协议全部由 Rust 执行。

### 2.2 PKCE

当前验证过的授权流程包含 PKCE verifier/challenge 与既定 redirect。授权 URL 的参数必须与已验证客户端行为保持一致；特别不要随意增加 scope 或改写 redirect/client identity。任何修改都需要真实账号重新验收 entitlement 与 Hi-Res playback。

### 2.3 Device Code

TIDAL Device Code 返回的 verification URI 可能不带 scheme。协议层应返回可供 Control 安全打开的完整 URL，不能让浏览器把 `link.tidal.com/...` 当作 Atom Core 的相对路径。

### 2.4 Token refresh 与持久化边界

Refresh 请求由 Rust 协议引擎完成；新的 token 响应返回 Node 后，由 Node Core 更新其唯一 auth state / SecretStore。Rust 不把 token 写入自己的文件。

过期时间在 Node Core contract 中统一使用毫秒时间戳；Rust API 响应若使用秒或 `expiresIn`，只允许在薄 adapter 边界规范化一次。

### 2.5 API 分页

TIDAL 部分列表接口对单页 `limit` 有严格上限。协议实现必须在 Rust 内遵守平台限制；需要更多结果时通过 offset 分页获取，不把无效超大 limit 原样发给远端。

### 2.6 BTS / DASH 播放

TIDAL playback info 可能返回直接 URL、BTS manifest 或 MPEG-DASH MPD。正式处理都在 Rust：

```text
playback info
  -> direct URL / BTS -> stream URL
  -> DASH MPD         -> parse SegmentTemplate/Timeline
                         -> download init + media fragments
                         -> Core temp file
                         -> localPath
```

当前 DASH 实现只接受已经明确验证的 Number-based `SegmentTemplate` 形态。`$Time$`、无限 repeat 或无法确定的 template 明确失败，不能猜分段、静默降级成低质量 TS 路径或恢复旧 JavaScript materializer。

DASH materialization 只是无损容器级拼接，不参与音频 sample 处理；后续是否进入普通输出或 strict Diretta Source Direct 由 Core/audio-engine 决定。

---

## 3. N-API 边界

`streaming-api.node` 只暴露一个窄入口 `callStreamingProvider(platform, action, auth, params)`。不要增加 Rust-side Provider Registry、SessionManager 或第二套 Core domain model。

Node adapter 的职责仅限：

- 从 Core auth state 组装本次调用认证上下文；
- 调用唯一 Rust protocol engine；
- 将 Rust 私有响应形状规范化为现有 Core provider contract；
- 登录/token refresh 成功后更新 Node Core 的 auth state。

Web/Desktop 不应知道 `streaming-api.node` 的存在，它们继续只使用统一 Core Control Protocol。

---

## 4. 与音频引擎的边界

`streaming-api` 不处理 PCM/DSD，不拥有播放状态。在线平台 URL/manifest 解析完成后，Core 决定是否缓存/materialize 并调用唯一音频实现：

```text
Node Core PlaybackSourceResolver
        -> audio-engine.node
        -> audio-engine-core
             -> normal f32/DSP output
             -> strict Diretta Source Direct
```

Qobuz/TIDAL 协议层不得为了“直通”自行建立播放器或 Diretta connection。

---

## 5. 验收门禁

修改 Qobuz/TIDAL 协议实现后至少运行：

```text
cargo test -p streaming-api
pnpm typecheck
pnpm test:node
pnpm test:web
```

正式 Core 还必须验证 `audio-engine.node` 与 `streaming-api.node` 都被 no-SDK Core artifact 构建、加载和 staging；Diretta release 另按受控 SDK/hardware gate 验收。

真实账号验收重点：

- Qobuz login/search/catalog/getFileUrl/Hi-Res；
- TIDAL PKCE 或 Device Code、token refresh、search/catalog；
- TIDAL BTS 与 DASH 两种 playback path；
- 普通输出与 Diretta 都从同一 Core source resolver 进入；
- provider error 不通过第二套 JS fallback 隐藏。

最终原则只有两条：**Qobuz/TIDAL 平台协议只有 Rust 一套；Provider/Core authority 只有 Node Core 一套。**
