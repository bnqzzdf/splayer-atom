import assert from "node:assert/strict";
import test from "node:test";
import { addWsClient, getWsClientCount, removeWsClient, wsBroadcast } from "./broadcast";

interface FakeWs {
  sent: string[];
  send(payload: string): void;
}

test("Core broadcasts events to multiple controls and removes disconnected controls", () => {
  const first: FakeWs = {
    sent: [],
    send(payload) {
      this.sent.push(payload);
    },
  };
  const second: FakeWs = {
    sent: [],
    send(payload) {
      this.sent.push(payload);
    },
  };

  addWsClient(first as never);
  addWsClient(second as never);
  try {
    assert.equal(getWsClientCount(), 2);
    wsBroadcast({ type: "playerState", data: { state: "playing" } });
    assert.equal(first.sent.length, 1);
    assert.equal(second.sent.length, 1);

    removeWsClient(first as never);
    assert.equal(getWsClientCount(), 1);
    wsBroadcast({ type: "playerState", data: { state: "paused" } });
    assert.equal(first.sent.length, 1);
    assert.equal(second.sent.length, 2);
  } finally {
    removeWsClient(first as never);
    removeWsClient(second as never);
  }
  assert.equal(getWsClientCount(), 0);
});
