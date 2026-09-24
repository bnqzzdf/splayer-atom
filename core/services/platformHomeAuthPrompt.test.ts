import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

const platformHomeSource = read("../../src/pages/PlatformHome.vue");
const zhLocale = JSON.parse(read("../../src/i18n/locales/zh-CN.json")) as {
  platformHome: Record<string, unknown>;
};
const enLocale = JSON.parse(read("../../src/i18n/locales/en-US.json")) as {
  platformHome: Record<string, unknown>;
};

test("认证失效时平台首页给出「去登录」入口而不是裸错误串", () => {
  assert.match(platformHomeSource, /const isAuthError = \(message: string\): boolean =>/);
  // 各平台对「需要登录」的措辞不同，实测遇到的都要认出来
  assert.match(platformHomeSource, /not logged in/);
  assert.match(platformHomeSource, /authentication is required/);
  assert.match(platformHomeSource, /const errorNeedsLogin = computed/);
  // 模板：认证类错误显示去登录按钮，其余才展示原始报文
  assert.match(platformHomeSource, /v-if="errorNeedsLogin"/);
  assert.match(platformHomeSource, /platformHome\.signIn/);
  assert.match(platformHomeSource, /v-else>\{\{ error \}\}/);
  // 登录成功后自动重载，省掉用户手动刷新
  assert.match(platformHomeSource, /const onLoginDialogClose = async \(open: boolean\)/);
  assert.match(
    platformHomeSource,
    /if \(providerSessions\.sessions\[platform\.value\]\?\.authenticated\) await load\(\);/,
  );
  assert.match(platformHomeSource, /<StreamingLoginDialog/);
});

test("「去登录」文案中英文齐备", () => {
  for (const locale of [zhLocale, enLocale]) {
    const section = locale.platformHome;
    assert.equal(typeof section.authRequired, "string");
    assert.equal(typeof section.signIn, "string");
  }
  assert.equal((zhLocale.platformHome as Record<string, string>).signIn, "去登录");
});
