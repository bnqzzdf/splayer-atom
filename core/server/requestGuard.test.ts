import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { createRequestGuard, isTrustedHostname } from "./requestGuard";

const buildApp = (devSameHostAnyPort = false): Hono => {
  const app = new Hono();
  app.use("*", createRequestGuard({ devSameHostAnyPort }));
  app.post("/api/x", (c) => c.text("ok"));
  return app;
};

const post = (app: Hono, headers: Record<string, string>) =>
  app.request("/api/x", { method: "POST", headers, body: "{}" });

test("request guard allows same-origin Web Control and non-browser clients", async () => {
  const app = buildApp();
  assert.equal(
    (await post(app, { host: "192.168.1.5:14558", origin: "http://192.168.1.5:14558" })).status,
    200,
  );
  assert.equal((await post(app, { host: "192.168.1.5:14558" })).status, 200);
  assert.equal((await post(app, { host: "gentooplayer:14558" })).status, 200);
  assert.equal(
    (await post(app, { host: "[fe80::1]:14558", origin: "http://[fe80::1]:14558" })).status,
    200,
  );
});

test("request guard rejects cross-site, opaque-origin and DNS-rebinding requests", async () => {
  const app = buildApp();
  const crossSite = await post(app, {
    host: "192.168.1.5:14558",
    origin: "https://evil.example",
    "content-type": "text/plain",
  });
  assert.equal(crossSite.status, 403);
  assert.equal((await post(app, { host: "192.168.1.5:14558", origin: "null" })).status, 403);
  assert.equal(
    (
      await post(app, {
        host: "rebind.evil.example:14558",
        origin: "http://rebind.evil.example:14558",
      })
    ).status,
    403,
  );
  // 非开发模式下同主机不同端口也属跨源。
  assert.equal(
    (await post(app, { host: "192.168.1.5:14558", origin: "http://192.168.1.5:5173" })).status,
    403,
  );
});

test("request guard allows Vite origin on the same host in dev mode", async () => {
  const app = buildApp(true);
  assert.equal(
    (await post(app, { host: "192.168.1.5:14559", origin: "http://192.168.1.5:5173" })).status,
    200,
  );
  assert.equal(
    (await post(app, { host: "192.168.1.5:14559", origin: "http://evil.example:5173" })).status,
    403,
  );
});

test("trusted hostnames cover LAN names and explicit ATOM_ALLOWED_HOSTS", () => {
  assert.equal(isTrustedHostname("localhost"), true);
  assert.equal(isTrustedHostname("music.local"), true);
  assert.equal(isTrustedHostname("atom.home.arpa"), true);
  assert.equal(isTrustedHostname("music.example.com"), false);
  const previous = process.env.ATOM_ALLOWED_HOSTS;
  process.env.ATOM_ALLOWED_HOSTS = "music.example.com";
  try {
    assert.equal(isTrustedHostname("music.example.com"), true);
  } finally {
    if (previous === undefined) delete process.env.ATOM_ALLOWED_HOSTS;
    else process.env.ATOM_ALLOWED_HOSTS = previous;
  }
});
