import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  clearRecentLogs,
  coreLog,
  getDefaultLogLevel,
  getLogLevel,
  getLogLevelSnapshot,
  getRecentLogs,
  parseLogLevel,
  redactDiagnosticText,
  resetLogLevel,
  setLogLevel,
} from "./logger";

const withSavedEnv = (fn: () => void): void => {
  const prev = process.env.ATOM_LOG_LEVEL;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.ATOM_LOG_LEVEL;
    else process.env.ATOM_LOG_LEVEL = prev;
    resetLogLevel();
    clearRecentLogs();
  }
};

test("ATOM_LOG_LEVEL defaults to info and parses valid/invalid values", () => {
  withSavedEnv(() => {
    delete process.env.ATOM_LOG_LEVEL;
    assert.equal(getDefaultLogLevel(), "info");
    assert.equal(getLogLevel(), "info");
    assert.equal(parseLogLevel("DEBUG"), "debug");
    assert.equal(parseLogLevel("invalid"), null);

    process.env.ATOM_LOG_LEVEL = "warn";
    assert.equal(getDefaultLogLevel(), "warn");
    assert.equal(getLogLevel(), "warn");

    process.env.ATOM_LOG_LEVEL = "verbose";
    assert.equal(getDefaultLogLevel(), "info");

    const updated = setLogLevel("debug");
    assert.deepEqual(updated, { level: "debug", defaultLevel: "info", overridden: true });
    assert.deepEqual(getLogLevelSnapshot(), {
      level: "debug",
      defaultLevel: "info",
      overridden: true,
    });
  });
});

test("logger filters by active level and evicts ring buffer past 500 entries", () => {
  withSavedEnv(() => {
    delete process.env.ATOM_LOG_LEVEL;
    clearRecentLogs();

    const origDebug = console.debug;
    const origInfo = console.info;
    const origWarn = console.warn;
    const seen: string[] = [];
    console.debug = (...args: unknown[]) => seen.push(`debug:${String(args[1])}`);
    console.info = (...args: unknown[]) => seen.push(`info:${String(args[1])}`);
    console.warn = (...args: unknown[]) => seen.push(`warn:${String(args[1])}`);
    try {
      coreLog.debug("hidden-at-info");
      coreLog.info("visible-at-info");
      assert.deepEqual(seen, ["info:visible-at-info"]);
      assert.equal(getRecentLogs().length, 1);

      setLogLevel("debug");
      coreLog.debug("visible-at-debug");
      assert.equal(getRecentLogs().length, 2);

      clearRecentLogs();
      for (let i = 0; i < 520; i += 1) {
        coreLog.warn(`entry-${i}`);
      }
      const logs = getRecentLogs();
      assert.equal(logs.length, 500);
      assert.equal(logs[0]?.message, "entry-20");
      assert.equal(logs[499]?.message, "entry-519");
    } finally {
      console.debug = origDebug;
      console.info = origInfo;
      console.warn = origWarn;
    }
  });
});

test("logger redacts credentials in strings, URLs, and structured objects", () => {
  withSavedEnv(() => {
    setLogLevel("debug");
    clearRecentLogs();

    const homeFile = path.join(os.homedir(), ".cache", "splayer-atom", "songs");
    const text = redactDiagnosticText(
      `dir=${homeFile} https://alice:topsecret@music.example/stream?token=abc123&vkey=xyz987&fmt=flac Authorization: Bearer eyJhbGciOiJIUzI1NiJ9 Cookie: MUSIC_U=supersecretvalue`,
    );
    assert.doesNotMatch(text, /topsecret|abc123|xyz987|eyJhbGciOiJIUzI1NiJ9|supersecretvalue/);
    if (os.homedir() && os.homedir() !== "/") {
      assert.equal(text.includes(os.homedir()), false);
      assert.match(text, /~[\\/]\.cache[\\/]splayer-atom[\\/]songs/);
    }
    assert.match(text, /fmt=flac/);

    const origInfo = console.info;
    console.info = () => {};
    try {
      const circular: Record<string, unknown> = {
        cookie: "MUSIC_U=secret-cookie",
        qm_keyst: "secret-qm-key",
        uin: "12345678",
        jumpUrl: "https://example.com/auth?ptsigx=secret-sig&ok=1",
        safe: "pcm-44100",
      };
      circular.self = circular;
      coreLog.info("login payload", circular);

      const entry = getRecentLogs()[0];
      assert.ok(entry);
      assert.doesNotMatch(entry.message, /secret-cookie|secret-qm-key|12345678|secret-sig/);
      assert.match(entry.message, /pcm-44100/);
      assert.match(entry.message, /\[REDACTED\]/);
      assert.match(entry.message, /\[Circular\]/);
    } finally {
      console.info = origInfo;
    }
  });
});
