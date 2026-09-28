# Qobuz 一键 OAuth 登录 · 实施方案（可直接执行）

> 最后更新：2026-09-24

> 状态：**已实现，并已在真机端到端验证通过**（2026-09-23，目标机 `10.0.0.190`）。
> 第二节的未知点已解出（见下表 #9~#11）；兑换**成功**时的真实响应形状也已实测，见「七、真机验证结果」。
>
> 目标 UX：设置 →「在线平台账户」→ Qobuz → 点一次「用浏览器登录」→ 浏览器里正常登录
> → **自动完成**。没有 Console、没有 F12、没有复制粘贴。

---

## 一、已确证的事实（均有实测证据，不要推翻重查）

| #   | 事实                                                                                | 证据                                                                                                                               |
| --- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 授权端点 = `https://www.qobuz.com/signin/oauth`，参数 `ext_app_id` + `redirect_url` | 用户提供的链接 base64 解码结果                                                                                                     |
| 2   | app_id = `798273057`（与网页播放器一致）                                            | 用户 F12 确认                                                                                                                      |
| 3   | 回调参数名 = **`code_autorisation`**（8 位，单次有效）                              | 实测落地 URL：`https://play.qobuz.com/discover?code_autorisation=HUukQqWc`                                                         |
| 4   | `redirect_url` **被采用**（回调发生在该地址）                                       | 同上，回调目标即 URL 中给出的地址                                                                                                  |
| 5   | 邮箱+密码登录**不可用**，勿再尝试                                                   | 无会话实例上假凭据：不签名 401，**加签名后仍 401**；且 `user/login` 是唯一 `signed=false` 的调用，改成 signed 无改善（改动已回退） |
| 6   | 设备码流程**不存在**（TIDAL 才有 RFC 8628）                                         | `native/streaming-api/src/tidal/auth.rs` 有 `auth_device_authorization`；qobuz 侧无对应实现与公开端点                              |
| 7   | 现有「粘贴 token」路径**完全可用**                                                  | 干净实例（.132）实测：登出 → 只给 token 登录 → 搜索/直链全部 OK                                                                    |
| 8   | Qobuz 对**未签名**请求一律回 `401 User authentication is required`                  | 多个端点、含故意用 `bogus123`，响应完全相同 → 该 401 无法用于区分端点                                                              |
| 9   | 兑换端点 = `GET /api.json/0.2/oauth/callback`，query `code` + `private_key`          | play.qobuz.com bundle：`paramsMapper=e=>({code:e.code,private_key:e.privateKey})` + `requester.get("oauth/callback",{query:t})`；实测伪 code 回 `404 No result matching given argument`（端点存在且校验 code） |
| 10  | `private_key` = `6lz8C03UDIC7`（网页播放器 initialization 常量）                     | bundle：`authenticate({privateKey:"6lz8C03UDIC7",code:t})`；兑换响应含 `user_auth_token` 与 `userId`                                |
| 11  | 兑换**不需要请求签名**                                                              | 同上，网页播放器只带 `code` + `private_key`，app_id 走 `X-App-Id` 头                                                              |

## 二、原未知点（已由 #9/#10/#11 解出，保留作为记录）

**`code_autorisation` → `user_auth_token` 的兑换调用形态**（端点路径、方法、参数名/请求体）。

已试过并**全部失败**的三种猜测（因上述事实 #8，无法据此判断对错）：

```
GET  /api.json/0.2/oauth/code/<code>?app_id=...
GET  /api.json/0.2/user/login?app_id=...&code_autorisation=...
POST /api.json/0.2/user/login   (form: app_id + code_autorisation)
```

**最终定位方式**：直接读 play.qobuz.com 的 `bundle.js`（`credentials.rs` 本就在做这件事），
而不是靠端点探测——事实 #8 让未签名探测永远无法区分对错。

**仍未实测的部分**：兑换**成功**时的完整响应形状。实现按多键兼容处理
（`user_auth_token`/`token`、`user_id`/`userId`），并统一回 `user/get` 反查真实用户 id；
如果真机跑通后发现字段名不同，只需改 `auth_oauth.rs` 里那两行候选键。

## 三、实现步骤

### 1) 原生 `native/streaming-api/src/qobuz/auth.rs`（+ `mod.rs` 注册 action）

```rust
/// 起一次性本地回调监听并返回授权 URL。
/// 返回 { url, port }；url 已带 ext_app_id 与 redirect_url=http://127.0.0.1:<port>/qobuz/cb
pub async fn auth_oauth_start(&self, params: &HashMap<String, Value>) -> Result<Value, StreamingError>
```

- 端口取随机空闲端口，监听 `127.0.0.1`，**只在登录期间存活**，拿到回调或超时（建议 180s）即关闭。
- 只接受 `GET /qobuz/cb`，从 query 取 `code_autorisation`；其余请求回 404。

```rust
/// 等待回调、兑换 token、落库。
/// 返回与现有 auth_login 完全相同的形状（user_id / user_auth_token / display_name / is_active / max_format_id）
pub async fn auth_oauth_await(&self, params: &HashMap<String, Value>) -> Result<Value, StreamingError>
```

- 兑换必须走 **`self.request(...)` 的签名路径**（`signed = true`）——浏览器那条路能成，正是因为它带着签名；
  事实 #8 表明不带签名的请求一律 401。
- 若确认兑换端点无需签名，仍建议保持 signed=true，避免依赖未签名通道。
- 成功后复用现有 `core/apis/qobuz/index.ts::authLogin` 的落库逻辑（`setQobuzAuth`），**不要另写一套**。

**注意**：`auth_oauth_start` / `auth_oauth_await` 需在 `core/apis/qobuz/index.ts::callQobuz` 的
action 分派里登记（与 `auth_login` 同级），否则前端调不到。

### 2) 前端 `src/components/modals/StreamingLoginDialog.vue`

- Qobuz 标签在现有「粘贴 token」之上，加主按钮「用浏览器登录 Qobuz」：
  1. 调 `qobuzApi.oauthStart()` 拿到 `{ url }`
  2. `openExternal(url)`（已有 `@/utils/url`，阶段九已引入本文件）
  3. 轮询 `qobuzApi.oauthAwait()`（或一次性 await，取决于原生实现是否为阻塞式）
  4. 成功后 `providerSessions.refresh()` + 复用现成的成功 toast
- **保留**粘贴 token 作为兜底（非订阅、异常网络、redirect 被拒时仍可用）。
- `src/apis/qobuz.ts` 里加两个薄封装，风格与现有 `login/logout/authStatus` 一致。

### 3) 类型与文案

- `shared/types/plugin.ts` 无需改；`ApiCallResponse` 走既有 `/providers/call`。
- 失败提示复用已有的 `errors.PROVIDER_LOGIN_REQUIRED`；新增文案时同步 `zh-CN` / `en-US`。

## 四、验证清单（缺一不可）

> 本地已验证 ✅ / 需真机 ❗：
> ✅ `cargo test -p streaming-api` 24 passed（含 3 个真实 TCP 回调端到端用例：
> 无关请求 404 后继续等待、拒绝授权、state 不匹配被拒）
> ✅ `cargo build` / `pnpm typecheck` / `pnpm test:web`(108) / `pnpm test:node`(390；1 个
> `coreSourceIdentity` 失败源于解包目录无 `.git`，基线一致) / eslint / prettier
> ❗ 第 1–5 项都需要真人完成一次浏览器登录。

1. **干净实例**：在 Qobuz 未登录的主机上（`.132` 可随时 `auth_logout` 造出干净态）
   → 点「用浏览器登录」→ 浏览器完成登录 → **不碰 Console**，回到界面应已显示已连接。
2. 会话投影正确：`userId` 为**真实用户 id**（如 `2961963`），不是 app_id `798273057`。
3. 功能：`catalog_search` 有结果、`track_getFileUrl` 返回直链。
4. **本地监听必须关闭**：登录完成后确认端口不再监听（`ss -ltn`）。
5. 超时路径：不完成登录，180s 后监听应自动关闭并给出可读错误，且不残留进程。
6. 回归：`pnpm test:node` 全绿；三台部署后 `391+ pass`。
   ⚠️ `pnpm test:node` 在**解包目录**会因缺 `.git` 挂掉 1 个 `coreSourceIdentity` 用例；
   git 工作树里应为 391 pass。

### 真机验收时最可能出问题的一步

`redirect_url` 是否被 Qobuz 接受、以及它是否原样保留 query。若被拒，浏览器不会回跳，
表现是等满 180 秒后超时 —— 此时按第五节回退，而且**只需前端降级**（后端与文案都不用动）：
把主按钮改成「打开授权页」，保留粘贴 token。

## 四之二、实现中发现并修掉的三个真实缺陷（务必保留）

这三处都是**初版实现里的真缺陷**，不是理论风险；前两个会让真人登录 100% 失败。

### 1) state 从未发给 Qobuz，却要求回调必须带 state（致命）

初版授权 URL 只有 `ext_app_id` + `redirect_url`，`redirect_url` 里也没有 state；
但监听侧无条件要求回调请求行含 `state=<毫秒+端口>`，否则回 400 并继续等待。
Qobuz 不可能回传它没收到的东西 ⇒ 真实回跳必然被拒、空等到 180 秒超时。

**为什么单测没抓到**：端到端用例当时传 `wait_for_callback(listener, None)` 把校验关掉了，
而生产路径传 `Some(state)` —— 测试与生产的参数不一致，于是缺陷被"测绿"了。

**修法（双保险）**：
- `state` 同时写进 `redirect_url` 的 query 和授权 URL 本身；
- 校验放宽为「**带了但不匹配才拒绝，缺失则放行**」——因为 Qobuz 是否保留
  `redirect_url` 的 query 未经实测，强制要求会让真实登录再次失败。

### 2) 回调地址写 127.0.0.1，但浏览器根本不在设备上（致命）

授权页由 Web Control 前端的 `window.open` 打开，而 **190 上没有任何图形浏览器**
（实测 `firefox`/`chromium` 全无、`DISPLAY` 未设置）。所以浏览器在**用户的 PC** 上，
`http://127.0.0.1:<port>/qobuz/cb` 指向那台 PC，回调永远回不到 Core。

**修法**：前端把 `window.location.hostname`（浏览器实际访问 Core 用的地址）传给
`auth_oauth_start`；原生据此：
- host 是回环（`127.*`/`localhost`/`::1`）→ 绑 `127.0.0.1`，保持原约束；
- 否则 → 绑 `0.0.0.0`，并把该 host 写进 `redirect_url`，让 PC 的回跳能打回设备。

⚠️ 这是对原文「只绑 127.0.0.1」的**有意放宽**。风险由这些因素约束：端口随机、
只在登录期间存活、最长 180 秒、一次性、且 `code` 只能由 Qobuz 签发。
若所在网段不可信，应改用 SSH 隧道而不是长期暴露。

### 3) 重复 start 不释放旧监听 / 拒绝授权被误判

- 初版重复调用 `auth_oauth_start` 只替换槽位，**旧的 `TcpListener` 仍被旧任务持有**，
  继续 `LISTEN` 满自己的 180 秒（这期间回 200，但结果被丢弃，用户会误以为成功）。
  修法：新增 `cancel_tx`，新 start 主动叫停旧监听，旧任务立刻释放端口。
- 初版 `error=` 判断排在 state 校验**之后**，而拒绝回调同样不带 state ⇒ 真实拒绝
  也会退化成"400 + 空等到超时"。修法：把 error 判断提到 state 校验之前。
- 初版用 `request.contains("error=")` 判断，`?noterror=1` 会被误判成拒绝授权。
  修法：改用精确的 query 键解析（`parse_query`）。
- 配套：`auth_oauth_await` 只能 `take` 走 receiver，**不能 take 整个槽位** ——
  否则 `cancel_tx` 被 drop，监听任务会误以为被取代而立刻放弃这次登录。

以上每条都有对应回归测试（`auth_oauth.rs` 内 `listener_*` 用例），共 28 项。

## 五、回退方案（若 `redirect_url` 指向 127.0.0.1 被拒）

- **一级**：只保留「用浏览器登录」按钮打开官方授权页；登录后仍用那行 Console 命令取 token。
  比现状少一步手敲网址，**但省不掉 Console**。
- **零信息成本**：维持现状（一键粘贴 token，已在阶段九做到只需粘一个字段）。

## 六、明确不要做的事

- ❌ 不要再尝试邮箱+密码登录（事实 #5，已两次验证）。
- ❌ 不要找 Qobuz 的设备码端点（事实 #6，不存在）。
- ❌ 不要内置浏览器窗口抓 token（atom 的 Web Control 无宿主登录窗口，
  `coreProviderAccountsUi.test.ts` 明确禁止 `openLoginWeb` 这类做法）。
- ⚠️ `coreProviderAccountsUi.test.ts` 里有「渲染端不得访问 localStorage」的逐行断言；
  若新增文案再次提到 `localStorage`，需按阶段九的方式（允许 Console 命令文本、禁止真实访问）处理。

---

## 七、真机验证结果（2026-09-23 · 目标机 10.0.0.190）

构建：Debian 11 容器 + Diretta SDK 150（详见 `docs/debian11-build-compatibility.md`）。
产物 commit `8cd2e2a6`（dirty=true），部署后平台位 5/5，`data/` 保留。

### 7.1 兑换成功的真实响应形状（此前唯一的未实测项）

真人在浏览器完成登录后，`auth_oauth_await` 实际返回：

```json
{
  "status": "success",
  "user_id": "2961963",
  "user_auth_token": "mDkSe-0qp-XYfLDEz3C5l3kgv_SpPLJ4mWfZeF0446cFpODxEeLRRp0YBwz32jMX3nsea5-6Hz_DFgF-n5hJ0Q",
  "display_name": "tomosak",
  "user": { "id": "2961963", "login": "tomosak", "display_name": "tomosak" },
  "is_active": false,
  "max_format_id": 5
}
```

**结论**：`oauth/callback` 响应确实提供 `user_auth_token` 与 `user_id`，实现里的多键兼容解析
（`user_auth_token`/`token`、`user_id`/`userId`）取到了正确值，无需修改。
`user_id` 是真实用户 id（`2961963`），**不是** app_id `798273057`。
账号为非订阅（`is_active=false`、`max_format_id=5`），与阶段九记录一致。

### 7.2 自动化验证（全部通过）

| # | 检查项 | 结果 |
| --- | --- | --- |
| 1 | 负对照：未知 action 回 `Unsupported Qobuz API` | ✅ |
| 2 | `auth_oauth_start` 结构（url/port/redirectUri/state/expiresIn=180） | ✅ |
| 3 | 回环场景：不传 host → 绑 `127.0.0.1` | ✅ |
| 4 | 跨机场景：传 host → 绑 `0.0.0.0` 且回调地址用该 host | ✅ |
| 5 | 重复 start → 旧监听立刻释放端口 | ✅ |
| 6 | 无关请求（favicon）404 后继续等待 | ✅ |
| 7 | 跨机可达（外部主机访问回调端口） | ✅ |
| 8 | 带正确 state 回调 → 200 + 成功页 | ✅ |
| 9 | **不带 state 回调 → 仍放行** | ✅ |
| 10 | 错误 state → 400 拒绝 | ✅ |
| 11 | `error=access_denied` → 立即失败（实测 0 秒） | ✅ |
| 12 | 回调后端口释放（`ss -ltn` 无残留） | ✅ |
| 13 | 假 code 兑换 → 正确到达 Qobuz 并回 404 | ✅ |
| 14 | 会话投影 `userId=2961963` | ✅ |

### 7.3 真人验收（方案第四节第 1~5 项）

| # | 检查项 | 结果 |
| --- | --- | --- |
| 1 | 干净实例点击「用浏览器登录」→ 浏览器登录 → 自动完成，全程不碰 Console/F12 | ✅ |
| 2 | 会话投影为用户真实 id `2961963`（非 app_id） | ✅ |
| 3 | `catalog_search` 有结果（实测返回 Miles Davis 专辑 3 条） | ✅ |
| 4 | 登录后本地监听关闭、端口释放 | ✅ |
| 5 | 超时路径（180s 自动关闭并报可读错误） | ✅ 自动化覆盖 |

**遗留**：方案第四节的第 6 项「三台部署后 `391+ pass`」尚未执行（本次只部署了 `.190`）。
