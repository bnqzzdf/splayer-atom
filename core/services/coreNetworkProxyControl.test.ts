import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const proxySource = readFileSync(new URL("../utils/proxy.ts", import.meta.url), "utf8");
const routesSource = readFileSync(new URL("../atom/headless/routes.ts", import.meta.url), "utf8");
const serviceSettingsSource = readFileSync(
  new URL("../../src/settings/categories/services.ts", import.meta.url),
  "utf8",
);

test("Network proxy configuration and test already belong to the Core network stack", () => {
  assert.match(proxySource, /store\.get\("system\.networkProxy"\)/);
  assert.match(proxySource, /export const fetchWithProxy/);
  assert.match(proxySource, /export const testNetworkProxy/);
});

test("Web tests the Core proxy instead of browser-local networking", () => {
  assert.match(routesSource, /api\.post\("\/system\/network-proxy\/test"/);
  assert.match(routesSource, /await testNetworkProxy\(\)/);
  assert.match(
    serviceSettingsSource,
    /request<\{ ok: boolean \}>\("\/system\/network-proxy\/test"/,
  );
  assert.doesNotMatch(serviceSettingsSource, /window\.api/);
});
