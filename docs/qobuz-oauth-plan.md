# Qobuz 一键 OAuth 登录 · 实施方案（可直接执行）

> 状态：**方案已定，待实现**。本文把开工所需的全部事实、唯一未知点、实现步骤与验证方式固化下来，
> 使接手的会话无需重新调研即可动手。相关背景见 `CHANGES.md` 阶段九。
>
> 目标 UX：设置 →「在线平台账号」→ Qobuz → 点一次「用浏览器登录」→ 浏览器里正常登录
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

## 二、唯一未知点（开工前需要它，或用一个探针替代）

**`code_autorisation` → `user_auth_token` 的兑换调用形态**（端点路径、方法、参数名/请求体）。

已试过并**全部失败**的三种猜测（因上述事实 #8，无法据此判断对错）：

```
GET  /api.json/0.2/oauth/code/<code>?app_id=...
GET  /api.json/0.2/user/login?app_id=...&code_autorisation=...
POST /api.json/0.2/user/login   (form: app_id + code_autorisation)
```

**获取方式（一次，约 1 分钟）**——请用户操作：

1. 打开 DevTools → Network，勾选 **Preserve log**（否则跳转会清空记录）
2. 点授权链接并完成登录，落地到 `play.qobuz.com/discover?code_autorisation=...`
3. 找到落地后**第一条新的 `api.json` 请求**，提供：**URL（含 query）+ 方法 + 请求体（若有）**

**若无用户配合**：本方案第 1 步（本地监听）即可自行产出**未被消费的新 code**，
拿到后用现有签名机制逐个探针候选端点，同样能定位——只是多一轮。

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

1. **干净实例**：在 Qobuz 未登录的主机上（`.132` 可随时 `auth_logout` 造出干净态）
   → 点「用浏览器登录」→ 浏览器完成登录 → **不碰 Console**，回到界面应已显示已连接。
2. 会话投影正确：`userId` 为**真实用户 id**（如 `2961963`），不是 app_id `798273057`。
3. 功能：`catalog_search` 有结果、`track_getFileUrl` 返回直链。
4. **本地监听必须关闭**：登录完成后确认端口不再监听（`ss -ltn`）。
5. 超时路径：不完成登录，180s 后监听应自动关闭并给出可读错误，且不残留进程。
6. 回归：`pnpm test:node` 全绿；三台部署后 `391+ pass`。

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
