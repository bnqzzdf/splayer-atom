import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Hono } from "hono";
import { createDynamicCacheRoute } from "./cacheRoute";

test("image cache route survives late directory creation and follows cache root changes", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "splayer-atom-cache-route-"));
  let root = path.join(temp, "first", "covers");
  const app = new Hono();
  app.use(
    "/cache/covers/*",
    createDynamicCacheRoute("/cache/covers", () => root),
  );

  try {
    assert.equal((await app.request("/cache/covers/cover.jpg")).status, 404);

    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "cover.jpg"), "first");
    assert.equal(await (await app.request("/cache/covers/cover.jpg")).text(), "first");

    root = path.join(temp, "second", "covers");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "cover.jpg"), "second");
    assert.equal(await (await app.request("/cache/covers/cover.jpg")).text(), "second");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
