import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeExactHttpInput } from "./exactInput";

test("exact HTTP input preserves response bytes and requests identity encoding", async () => {
  const bytes = Buffer.from([0, 1, 2, 3, 0xfe, 0xff, 9, 8, 7]);
  let acceptEncoding = "";
  const server = http.createServer((request, response) => {
    acceptEncoding = String(request.headers["accept-encoding"] ?? "");
    response.writeHead(200, { "Content-Type": "application/octet-stream" });
    response.end(bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const dir = await mkdtemp(path.join(os.tmpdir(), "splayer-atom-exact-input-"));
  const filePath = path.join(dir, "fixture.audio");
  try {
    await writeExactHttpInput(`http://127.0.0.1:${address.port}/fixture`, filePath);
    assert.equal(acceptEncoding, "identity");
    assert.deepEqual(await readFile(filePath), bytes);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("exact HTTP input does not publish empty or failed responses", async () => {
  const server = http.createServer((request, response) => {
    if (request.url === "/empty") {
      response.writeHead(200);
      response.end();
      return;
    }
    response.writeHead(503);
    response.end("unavailable");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const dir = await mkdtemp(path.join(os.tmpdir(), "splayer-atom-exact-input-fail-"));
  try {
    for (const route of ["empty", "failed"]) {
      const filePath = path.join(dir, `${route}.audio`);
      await assert.rejects(
        writeExactHttpInput(`http://127.0.0.1:${address.port}/${route}`, filePath),
      );
      await assert.rejects(access(filePath));
      await assert.rejects(access(`${filePath}.part`));
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
