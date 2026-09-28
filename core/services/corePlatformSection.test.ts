import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative: string): string =>
  readFileSync(new URL(`../../${relative}`, import.meta.url), "utf8");

const qobuzDiscoverSource = read("native/streaming-api/src/qobuz/discover.rs");
const tidalDiscoverSource = read("native/streaming-api/src/tidal/discover.rs");
const platformHomeSource = read("src/services/platformHome.ts");
const platformHomePageSource = read("src/pages/PlatformHome.vue");
const platformSectionPageSource = read("src/pages/PlatformSection.vue");
const routerSource = read("src/router/index.ts");

/** 从 TS 的容器键 → 端点名映射表里取出所有端点名 */
const mappedQobuzEndpoints = (): string[] => {
  const block = platformHomeSource.match(
    /const QOBUZ_SECTION_ENDPOINTS: Record<string, string> = \{([\s\S]*?)\n\};/,
  );
  assert.ok(block, "platformHome.ts 里应当有 QOBUZ_SECTION_ENDPOINTS 映射表");
  return [...block[1].matchAll(/:\s*"([^"]+)"/g)].map((match) => match[1]);
};

/** 从 TS 的容器键 → 端点名映射表里取出所有容器键 */
const mappedQobuzKeys = (): string[] => {
  const block = platformHomeSource.match(
    /const QOBUZ_SECTION_ENDPOINTS: Record<string, string> = \{([\s\S]*?)\n\};/,
  );
  assert.ok(block, "platformHome.ts 里应当有 QOBUZ_SECTION_ENDPOINTS 映射表");
  return [...block[1].matchAll(/^\s*([a-z_]+):/gm)].map((match) => match[1]);
};

/** 取出原生侧 discover/section 的端点白名单 */
const nativeQobuzSections = (): string[] => {
  const block = qobuzDiscoverSource.match(/const ALLOWED: \[&str; \d+\] = \[([\s\S]*?)\];/);
  assert.ok(block, "原生 discover.rs 里应当有 ALLOWED 白名单");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
};

test("Qobuz 分区端点名与原生白名单逐字一致", () => {
  // 映射表在前端、白名单在原生：两边漂掉不会在构建期暴露，
  // 只会在用户点「查看全部」时才报 InvalidParam，所以在这里钉死。
  assert.deepEqual(mappedQobuzEndpoints().sort(), nativeQobuzSections().sort());
});

test("Qobuz「查看全部」不给平台本身没有更多条目的容器", () => {
  for (const key of ["banners", "recent_releases", "playlists_tags"]) {
    assert.ok(
      !mappedQobuzKeys().includes(key),
      `${key} 在实测里 has_more 恒为 false，不该有翻页端点`,
    );
  }
});

test("TIDAL pages_get 支持 data/<uuid> 路径并补齐分页参数", () => {
  // 首页模块的 dataApiPath 形如 pages/data/<uuid>，原生按 pages/{pageId} 拼接
  assert.match(
    tidalDiscoverSource,
    /let segments: Vec<&str> = page_id\.split\('\/'\)\.collect\(\)/,
  );
  assert.match(tidalDiscoverSource, /segments\.len\(\) <= 2/);
  // 每段都要是纯标识符，不能把任意字符串拼进端点
  assert.match(tidalDiscoverSource, /is_identifier/);
  // deviceType / limit / offset：与 pages/home 同一套
  assert.match(
    tidalDiscoverSource,
    /req_params\.insert\("deviceType"\.to_string\(\), device_type\.to_string\(\)\)/,
  );
  assert.match(
    tidalDiscoverSource,
    /req_params\.insert\("limit"\.to_string\(\), limit\.to_string\(\)\)/,
  );
  assert.match(
    tidalDiscoverSource,
    /req_params\.insert\("offset"\.to_string\(\), offset\.to_string\(\)\)/,
  );
  // locale 是硬要求：模块数据端点缺了回 400，只给 deviceType 不够（实测）
  assert.match(
    tidalDiscoverSource,
    /req_params\.insert\("locale"\.to_string\(\), locale\.to_string\(\)\)/,
  );
  assert.match(tidalDiscoverSource, /unwrap_or\("en_US"\)/);
  // 前端把当前语言带下去，而不是只靠原生默认值
  assert.match(platformSectionPageSource, /locale: locale\.value/);
});

test("分区「查看全部」的入口与页面都已接线", () => {
  // 首页：分区标题栏的入口只在分区确实还能翻页时出现
  assert.match(platformHomePageSource, /qobuzSectionEndpoint\(key\)/);
  assert.match(platformHomePageSource, /tidalModulePath\(paged\)/);
  assert.match(platformHomePageSource, /v-if="section\.more"/);
  assert.match(platformHomePageSource, /t\("platformHome\.viewAll"\)/);
  // 封面上要有音质角标
  assert.match(platformHomePageSource, /v-if="item\.badge"/);
  // 分区页按平台各自的翻页入口取数据，并把 type 带去判定条目类型
  assert.match(platformSectionPageSource, /qobuzApi\.discoverSection\(endpoint, \{/);
  assert.match(platformSectionPageSource, /tidalApi\.pagesGet\(path, \{/);
  assert.match(platformSectionPageSource, /toTidalItem\(entry, tidalModuleType\.value\)/);
  // 路由：定位信息全在 URL 里，页面可独立刷新
  assert.match(routerSource, /name: "platform-section"/);
  assert.match(routerSource, /platforms\/:platform\/section\/:section/);
  assert.match(routerSource, /@\/pages\/PlatformSection\.vue/);
});

test("音质角标来自平台声明的规格，而不是猜", () => {
  // Qobuz 看 audio_info；TIDAL 看 mediaMetadata.tags（audioQuality 只写当前档）
  assert.match(platformHomeSource, /asRecord\(asRecord\(raw\)\.audio_info\)/);
  assert.match(platformHomeSource, /maximum_bit_depth/);
  assert.match(platformHomeSource, /maximum_sampling_rate/);
  assert.match(platformHomeSource, /asRecord\(item\.mediaMetadata\)\.tags/);
  assert.match(platformHomeSource, /HIRES_LOSSLESS/);
  assert.match(platformHomeSource, /DOLBY_ATMOS/);
});
