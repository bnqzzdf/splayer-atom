import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

const tidalConfigSource = read("../../native/streaming-api/src/tidal/config.rs");
const tidalAuthSource = read("../../native/streaming-api/src/tidal/auth.rs");
const loginDialogSource = read("../../src/components/modals/StreamingLoginDialog.vue");
const platformHomeSource = read("../../src/pages/PlatformHome.vue");

test("TIDAL 不再申请未使用的 w_sub（它会让 refresh 被服务端拒绝）", () => {
  // 实测报错：
  //   400 One or more of the requested scopes are not allowed.
  //   Requested scopes: [READ_USR_DATA, WRITE_USR, WRITE_SUBSCRIPTION]
  //   allowed scopes:   [READ_USR_DATA, WRITE_USR]
  // w_sub（写订阅）在整个代码库里从未被使用，申请它只带来拒绝。
  const scopeLine = /pub const TIDAL_SCOPE: &str = "([^"]+)"/.exec(tidalConfigSource);
  assert.ok(scopeLine, "未找到 TIDAL_SCOPE 定义");
  assert.ok(!scopeLine[1].includes("w_sub"), `TIDAL_SCOPE 不应包含 w_sub: ${scopeLine[1]}`);
  assert.match(scopeLine[1], /r_usr/);
  assert.match(scopeLine[1], /w_usr/);
});

test("TIDAL refresh 请求不发送 scope（RFC 6749 §6 省略即沿用原授权）", () => {
  // 刷新路径必须走 refresh_token_form，而该函数刻意只放 client_id/grant_type/refresh_token。
  assert.match(tidalAuthSource, /fn refresh_token_form<'a>/);
  assert.match(
    tidalAuthSource,
    /let form_params = refresh_token_form\(client_id, refresh_token, client_secret\);/,
  );

  const formStart = tidalAuthSource.indexOf("fn refresh_token_form<'a>");
  const formEnd = tidalAuthSource.indexOf("impl TidalClient", formStart);
  assert.ok(formStart > 0 && formEnd > formStart, "未找到 refresh_token_form 函数体");
  const formBody = tidalAuthSource.slice(formStart, formEnd);
  assert.doesNotMatch(formBody, /"scope"/, "refresh 表单不得包含 scope 字段");
  assert.match(formBody, /"grant_type", "refresh_token"/);
});

test("TIDAL 设备码登录拿到码后自动拉起浏览器（与 Qobuz 一键登录体验对齐）", () => {
  // 拿到设备码后应当直接打开授权页：用户不必自己找链接、也不用手输验证码
  //（verificationUriComplete 已经带上码）。
  assert.match(
    loginDialogSource,
    /tidalDeviceInfo\.value = info;[\s\S]{0,400}openTidalAuthUrl\(\);/,
  );
  // 与 Qobuz 走同一个外部打开出口
  assert.match(loginDialogSource, /import \{ openExternal \} from "@\/utils\/url";/);
  const openFn = /const openTidalAuthUrl = \(\): void => \{[\s\S]*?\n\};/.exec(loginDialogSource);
  assert.ok(openFn, "未找到 openTidalAuthUrl");
  assert.match(openFn[0], /openExternal\(url\)/);
  assert.doesNotMatch(openFn[0], /window\.open/);
  // 优先使用带码的完整链接
  assert.match(openFn[0], /verificationUriComplete/);
});

test("认证失效时平台首页给出「去登录」入口而不是裸错误串", () => {
  assert.match(platformHomeSource, /const isAuthError = \(message: string\): boolean =>/);
  assert.match(platformHomeSource, /not logged in/);
  assert.match(platformHomeSource, /authentication is required/);
  assert.match(platformHomeSource, /const errorNeedsLogin = computed/);
  // 模板：认证类错误显示去登录按钮，其余才展示原始报文
  assert.match(platformHomeSource, /v-if="errorNeedsLogin"/);
  assert.match(platformHomeSource, /platformHome\.signIn/);
  assert.match(platformHomeSource, /v-else>\{\{ error \}\}/);
  // 登录成功后自动重载，省掉手动刷新
  assert.match(platformHomeSource, /const onLoginDialogClose = async \(open: boolean\)/);
  assert.match(
    platformHomeSource,
    /if \(providerSessions\.sessions\[platform\.value\]\?\.authenticated\) await load\(\);/,
  );
  assert.match(platformHomeSource, /<StreamingLoginDialog/);
});
