import assert from "node:assert/strict";
import test from "node:test";
import { advanceUpnpEndTracker, createUpnpEndTracker, isNearUpnpEnd } from "./output";

test("UPnP end tracker detects natural end when renderer stays PLAYING and stalls near end", () => {
  const durationMs = 438_000;
  let tracker = createUpnpEndTracker();

  const run = (state: "playing" | "paused" | "stopped" | "loading", positionMs: number) => {
    const res = advanceUpnpEndTracker(tracker, {
      state,
      positionMs,
      durationMs,
      positionAvailable: true,
    });
    tracker = res.tracker;
    return res.isFinished;
  };

  assert.equal(run("playing", 120_000), false);
  assert.equal(run("playing", 435_000), false);
  assert.equal(run("playing", 438_000), false);
  // 单次 1s 粒度抖动不误判
  assert.equal(run("playing", 438_000), false);
  // 连续两次轮询位置未推进判定自然播完
  assert.equal(run("playing", 438_000), true);
});

test("UPnP end tracker detects natural end when RelTime resets to 0 after reaching near end", () => {
  const durationMs = 300_000;
  let tracker = createUpnpEndTracker();

  const run = (positionMs: number) => {
    const res = advanceUpnpEndTracker(tracker, {
      state: "playing",
      positionMs,
      durationMs,
      positionAvailable: true,
    });
    tracker = res.tracker;
    return res.isFinished;
  };

  assert.equal(run(10_000), false);
  assert.equal(run(299_000), false);
  assert.equal(run(0), true);
});

test("UPnP end tracker does not false-trigger on paused, mid-track stall, or initial stale near-end", () => {
  const durationMs = 300_000;
  let tracker = createUpnpEndTracker();

  const run = (
    state: "playing" | "paused" | "stopped" | "loading",
    positionMs: number,
    positionAvailable = true,
  ) => {
    const res = advanceUpnpEndTracker(tracker, {
      state,
      positionMs,
      durationMs,
      positionAvailable,
    });
    tracker = res.tracker;
    return res.isFinished;
  };

  // 新曲首次轮询读到旧曲曲尾后归零，不应误判
  assert.equal(run("playing", 299_000), false);
  assert.equal(run("playing", 0), false);

  // 曲中卡顿不触发
  assert.equal(run("playing", 100_000), false);
  assert.equal(run("playing", 100_000), false);
  assert.equal(run("playing", 100_000), false);

  // 曲尾暂停不触发，且恢复播放后重新计数
  assert.equal(run("playing", 298_000), false);
  assert.equal(run("paused", 298_000), false);
  assert.equal(run("paused", 298_000), false);
  assert.equal(run("playing", 298_000), false);
  assert.equal(run("playing", 298_000), false);
  assert.equal(run("playing", 298_000), true);

  // GetPositionInfo 失败时不触发
  tracker = createUpnpEndTracker();
  assert.equal(run("playing", 299_000, false), false);
  assert.equal(run("playing", 299_000, false), false);
  assert.equal(run("playing", 299_000, false), false);
});

test("UPnP end tracker still supports standard STOPPED near end", () => {
  const durationMs = 200_000;
  let tracker = createUpnpEndTracker();
  let res = advanceUpnpEndTracker(tracker, {
    state: "playing",
    positionMs: 198_000,
    durationMs,
    positionAvailable: true,
  });
  tracker = res.tracker;
  assert.equal(res.isFinished, false);

  res = advanceUpnpEndTracker(tracker, {
    state: "stopped",
    positionMs: 0,
    durationMs,
    positionAvailable: true,
  });
  assert.equal(res.isFinished, false);

  // 经过播放态到达曲尾后再 STOPPED（即使 RelTime 已归零）也能判定结束
  tracker = createUpnpEndTracker();
  tracker = advanceUpnpEndTracker(tracker, {
    state: "playing",
    positionMs: 100_000,
    durationMs,
    positionAvailable: true,
  }).tracker;
  tracker = advanceUpnpEndTracker(tracker, {
    state: "playing",
    positionMs: 199_000,
    durationMs,
    positionAvailable: true,
  }).tracker;
  res = advanceUpnpEndTracker(tracker, {
    state: "stopped",
    positionMs: 0,
    durationMs,
    positionAvailable: true,
  });
  assert.equal(res.isFinished, true);
  assert.equal(isNearUpnpEnd(197_000, 200_000), true);
  assert.equal(isNearUpnpEnd(190_000, 200_000), false);
});

test("UPnP end tracker does not false-trigger while a short track buffers at 0", () => {
  const durationMs = 1500;
  let tracker = createUpnpEndTracker();

  const run = (state: "playing" | "stopped", positionMs: number) => {
    const res = advanceUpnpEndTracker(tracker, {
      state,
      positionMs,
      durationMs,
      positionAvailable: true,
    });
    tracker = res.tracker;
    return res.isFinished;
  };

  assert.equal(isNearUpnpEnd(0, durationMs), false);
  assert.equal(run("playing", 0), false);
  assert.equal(run("playing", 0), false);
  assert.equal(run("playing", 0), false);
  assert.equal(run("stopped", 0), false);

  assert.equal(run("playing", 1000), false);
  assert.equal(run("playing", 1500), false);
  assert.equal(run("playing", 1500), false);
  assert.equal(run("playing", 1500), true);
});
