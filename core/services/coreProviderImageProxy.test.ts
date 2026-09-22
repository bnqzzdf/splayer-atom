import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const proxySource = readFileSync(new URL("./providerImageProxy.ts", import.meta.url), "utf8");
const routesSource = readFileSync(new URL("../atom/headless/routes.ts", import.meta.url), "utf8");
const tidalFormatSource = readFileSync(
  new URL("../../src/utils/format/tidal.ts", import.meta.url),
  "utf8",
);
const qobuzFormatSource = readFileSync(
  new URL("../../src/utils/format/qobuz.ts", import.meta.url),
  "utf8",
);

test("provider artwork proxy is allowlisted for Web Control", () => {
  assert.match(proxySource, /"resources\.tidal\.com", "static\.qobuz\.com"/);
  assert.match(proxySource, /url\.protocol !== "https:"/);
  assert.match(proxySource, /redirect: "error"/);
  assert.match(proxySource, /MAX_IMAGE_BYTES = 5 \* 1024 \* 1024/);
  assert.match(proxySource, /contentType\.startsWith\("image\/"\)/);
  assert.match(routesSource, /api\.get\("\/proxy\/image"/);
  assert.match(routesSource, /fetchProviderImage\(url!\)/);
  assert.match(tidalFormatSource, /coreApiOrigin.*\/api\/proxy\/image/s);
  assert.match(qobuzFormatSource, /coreApiOrigin.*\/api\/proxy\/image/s);
});
