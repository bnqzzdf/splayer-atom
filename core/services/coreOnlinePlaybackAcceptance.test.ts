import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const fixture = resolve(
  process.cwd(),
  "core/services/fixtures/coreOnlinePlaybackAcceptance.mock.ts",
);

/**
 * playbackSession 直接依赖 native/player/provider seams；单独 Node 进程用模块 mock
 * 驱动真实 session 行为，避免把测试专用注入点带进生产代码。
 */
test("Core online playback lifecycle passes deterministic acceptance harness", () => {
  const result = spawnSync(
    process.execPath,
    ["--experimental-test-module-mocks", "--import", "tsx", "--test", fixture],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        TSX_TSCONFIG_PATH: resolve(process.cwd(), "tsconfig.node.json"),
      },
    },
  );

  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join("\n") || "acceptance harness failed",
  );
});
