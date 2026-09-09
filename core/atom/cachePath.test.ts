import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveCacheUrl } from "./cachePath";

test("cache URL resolves only inside the supplied Core cache root", () => {
  const root = path.resolve("core-cache");
  assert.equal(
    resolveCacheUrl("cache://covers/album.jpg?v=1", root),
    path.join(root, "covers", "album.jpg"),
  );
  assert.equal(resolveCacheUrl("https://example.com/album.jpg", root), undefined);
  assert.equal(resolveCacheUrl("cache://../outside.jpg", root), undefined);
  assert.equal(resolveCacheUrl("cache://covers/%2e%2e/%2e%2e/outside.jpg", root), undefined);
  assert.equal(resolveCacheUrl("cache://covers/%E0%A4.jpg", root), undefined);
});
