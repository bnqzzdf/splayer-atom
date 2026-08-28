import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sessionSource = readFileSync(new URL("./playbackSession.ts", import.meta.url), "utf8");
const resolverSource = readFileSync(
  new URL("./playbackSourceResolver.ts", import.meta.url),
  "utf8",
);

test("Core bounds ordinary queue load failures and owns skip decisions", () => {
  assert.match(sessionSource, /const MAX_CONSECUTIVE_LOAD_FAILURES = 5/);
  assert.match(sessionSource, /const loadIndexWithPolicy = async/);
  assert.match(sessionSource, /isSkippablePlaybackError\(code\)/);
  assert.match(sessionSource, /publishPlaybackError\(code\)/);
  assert.match(sessionSource, /await loadIndexWithPolicy\(index, autoPlay\)/);
  assert.match(sessionSource, /await loadIndexWithPolicy\(index, true\)/);
});

test("sourceError recovery stays a single-track fresh resolve path", () => {
  const recovery = sessionSource.split("export const onNativeSourceError = (): boolean => {")[1];
  assert.ok(recovery, "Core sourceError handler should exist");
  assert.match(recovery, /shouldRetryPlaybackSource\(track, sourceRecoveryAttempts\)/);
  assert.match(recovery, /loadIndex\(index, true, true\)/);
  assert.doesNotMatch(recovery.split("export const getOutputDevices")[0], /loadIndexWithPolicy/);
});

test("provider auth errors never collapse into a generic Netease error", () => {
  const genericMapper = resolverSource
    .split("export const playbackSourceErrorCode = (error: unknown): ErrorCode => {")[1]
    ?.split("};")[0];
  assert.ok(genericMapper, "generic source error mapper should exist");
  assert.doesNotMatch(genericMapper, /NETEASE_LOGIN_EXPIRED/);

  const neteaseResolver = resolverSource
    .split("const resolveNetease = async (")[1]
    ?.split("const resolveQobuz")[0];
  assert.ok(neteaseResolver, "Netease resolver should exist");
  assert.match(neteaseResolver, /NETEASE_LOGIN_EXPIRED/);
});
