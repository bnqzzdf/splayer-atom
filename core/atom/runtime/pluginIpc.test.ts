import assert from "node:assert/strict";
import test from "node:test";
import { decodePluginIpc, encodePluginIpc } from "./pluginIpc";

test("Bun/Node JSON plugin IPC preserves nested typed binary payloads", () => {
  const original = {
    kind: "result",
    data: {
      bytes: new Uint8Array([0, 1, 128, 255]),
      body: new Uint8Array([12, 34]).buffer,
      nested: [Buffer.from([4, 5]), { ok: true }],
      sequence: 9_223_372_036_854_775_807n,
    },
  };
  const wire = JSON.parse(JSON.stringify(encodePluginIpc(original)));
  const result = decodePluginIpc(wire) as typeof original;
  assert.deepEqual(result.data.bytes, original.data.bytes);
  assert.deepEqual(new Uint8Array(result.data.body), new Uint8Array(original.data.body));
  assert.deepEqual(result.data.nested[0], new Uint8Array([4, 5]));
  assert.deepEqual(result.data.nested[1], { ok: true });
  assert.equal(result.data.sequence, original.data.sequence);
});
