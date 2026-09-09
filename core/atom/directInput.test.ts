import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { afterEach, test } from "node:test";
import {
  cleanupDirectInputs,
  discardDirectInput,
  materializeDirectInput,
  pruneDirectInputs,
} from "./directInput";

afterEach(async () => {
  await cleanupDirectInputs();
});

test("Direct input materialization preserves response bytes exactly and reuses the file", async () => {
  const payload = Buffer.from([0x66, 0x4c, 0x61, 0x43, 0x00, 0xff, 0x80, 0x01, 0x7f]);
  let requests = 0;
  const server = http.createServer((_request, response) => {
    requests += 1;
    response.writeHead(200, {
      "Content-Type": "audio/flac",
      "Content-Length": String(payload.length),
    });
    response.end(payload);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const source = `http://127.0.0.1:${address.port}/track.flac?token=test`;
    const first = await materializeDirectInput(source);
    const second = await materializeDirectInput(source);

    assert.equal(first, second);
    assert.match(first, /\.flac$/);
    assert.deepEqual(await readFile(first), payload);
    assert.equal(requests, 1);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("Direct input pruning keeps only the source that completed player load", async () => {
  const server = http.createServer((request, response) => {
    const payload = Buffer.from(request.url === "/first.flac" ? "fLaC-first" : "fLaC-second");
    response.writeHead(200, { "Content-Length": String(payload.length) });
    response.end(payload);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const first = await materializeDirectInput(`${base}/first.flac`);
    const second = await materializeDirectInput(`${base}/second.flac`);
    await pruneDirectInputs(second);

    await assert.rejects(() => readFile(first), /ENOENT/);
    assert.deepEqual(await readFile(second), Buffer.from("fLaC-second"));
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("Direct input discard removes only managed temporary files", async () => {
  const payload = Buffer.from("fLaC-discard");
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Length": String(payload.length) });
    response.end(payload);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const source = `http://127.0.0.1:${address.port}/discard.flac`;
    const filePath = await materializeDirectInput(source);
    await discardDirectInput(filePath);
    await assert.rejects(() => readFile(filePath), /ENOENT/);
    await discardDirectInput("/tmp/not-owned-by-direct-input.flac");
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("Direct input materialization rejects non-HTTP sources", async () => {
  await assert.rejects(
    () => materializeDirectInput("/tmp/already-local.flac"),
    /仅接受 HTTP\(S\) 音源/,
  );
});
