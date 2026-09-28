import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

const tidalConfigSource = read("../../native/streaming-api/src/tidal/config.rs");
const tidalAuthSource = read("../../native/streaming-api/src/tidal/auth.rs");
const loginDialogSource = read("../../src/components/modals/StreamingLoginDialog.vue");

test("TIDAL 不申请未使用的 w_sub（它会让 refresh 被服务端拒绝）", () => {
  // 实测报错：
  //   400 One or more of the requested scopes are not allowed.
  //   Requested scopes: [READ_USR_DATA, WRITE_USR, WRITE_SUBSCRIPTION]
  //   allowed scopes:   [READ_USR_DATA, WRITE_USR]
  // w_sub（写订阅）在整个代码库里从未被使用，申请它只会让刷新被拒。
  const scopeLine = /pub const TIDAL_SCOPE: &str = "([^"]+)"/.exec(tidalConfigSource);
  assert.ok(scopeLine, "未找到 TIDAL_SCOPE 定义");
  assert.ok(!scopeLine[1].includes("w_sub"), `TIDAL_SCOPE 不应包含 w_sub: ${scopeLine[1]}`);
  assert.match(scopeLine[1], /r_usr/);
  assert.match(scopeLine[1], /w_usr/);
});

test("TIDAL refresh 不发送 scope（RFC 6749 §6 省略即沿用原授权）", () => {
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

test("TIDAL 设备码登录拿到码后自动拉起浏览器（与 Qobuz 一键登录对齐）", () => {
  assert.match(
    loginDialogSource,
    /tidalDeviceInfo\.value = info;[\s\S]{0,400}openTidalAuthUrl\(\);/,
  );
  assert.match(loginDialogSource, /import \{ openExternal \} from "@\/utils\/url";/);
  const openFn = /const openTidalAuthUrl = \(\): void => \{[\s\S]*?\n\};/.exec(loginDialogSource);
  assert.ok(openFn, "未找到 openTidalAuthUrl");
  assert.match(openFn[0], /openExternal\(url\)/);
  assert.doesNotMatch(openFn[0], /window\.open/);
  assert.match(openFn[0], /verificationUriComplete/);
});

test("TIDAL 默认走无损那条，设备码（AAC）不得被摆成推荐路径", () => {
  const start = loginDialogSource.indexOf("<!-- TIDAL Tab -->");
  const end = loginDialogSource.indexOf("</STabs>");
  assert.ok(start > 0 && end > start, "未找到 TIDAL 页签");
  const tab = loginDialogSource.slice(start, end);
  // 跳过「已连接」区块：未登录时才渲染登录通路（v-else）
  const loggedOut = tab.slice(tab.indexOf("<template v-else>"));

  // 第一个（主）按钮是官方客户端 PKCE：它才有无损
  const firstButton = loggedOut.slice(
    loggedOut.indexOf("<SButton"),
    loggedOut.indexOf("</SButton>"),
  );
  assert.match(firstButton, /@click="onTidalAuthorize"/);
  assert.match(firstButton, /无损/);
  // 主按钮不能是设备码那条
  assert.doesNotMatch(firstButton, /onTidalRequestDeviceCode/);

  // 设备码整块收在折叠里，且必须写明代价
  assert.match(loggedOut, /@click="tidalDeviceOpen = !tidalDeviceOpen"/);
  const warn = /<SAlert type="warning">([\s\S]*?)<\/SAlert>/.exec(loggedOut);
  assert.ok(warn, "设备码通路缺少音质警示");
  assert.match(warn[1], /AAC/);
  assert.match(warn[1], /flac/);

  // 实测映射要留在文档里，避免以后有人凭印象"优化"成全自动
  assert.match(loginDialogSource, /设备码 client → HIGH \/ mp4a\.40\.2/);
  assert.match(tidalConfigSource, /LIMITED INPUT DEVICE CLIENT|Limited Input Device client/);
  // 回环回调已实测被拒（Error 11102）：这条负面结论也要留在源码里，别被重新试一遍
  assert.match(loginDialogSource, /回环回调（Qobuz 那种本机监听）\*\*已实测被拒\*\*/);
  assert.match(loginDialogSource, /Error 11102/);
  assert.match(tidalConfigSource, /Error 11102/);
});
