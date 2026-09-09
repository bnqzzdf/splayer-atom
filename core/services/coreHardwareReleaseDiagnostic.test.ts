import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { PlaybackSessionSnapshot, Track } from "../../shared/types/player";
import {
  collectHardwareReleaseDiagnostic,
  parseHardwareReleaseArgs,
} from "../../scripts/atom/check-hardware-release";

const track: Track = {
  id: "track-1",
  source: "local",
  path: "/private/music/secret.flac",
  title: "Acceptance Track",
  artists: [{ name: "Artist" }],
  album: { name: "Album", cover: "https://private.example/cover.jpg" },
  duration: 180_000,
  cover: "https://private.example/track.jpg",
  quality: {
    sampleRate: 96_000,
    channels: 2,
    bitsPerSample: 24,
    bitRate: 4_608_000,
    codec: "flac",
  },
};

const session: PlaybackSessionSnapshot = {
  active: true,
  mode: "queue",
  queue: [{ track }],
  originalQueue: null,
  index: 0,
  current: track,
  repeat: "list",
  shuffle: "off",
};

const responses = {
  "/api/info": {
    name: "SPlayer Atom Core",
    version: "0.1.0",
    commit: "abc123",
    sourceDirty: false,
    platform: "linux",
    arch: "x64",
    node: "24.18.0",
    nodeRange: ">=24.18.0 <25",
    nodeReference: "24.18.0",
    protocol: { version: 1 },
    capabilities: {
      library: true,
      playback: true,
      download: true,
      diretta: true,
      netease: true,
      qobuz: true,
      tidal: true,
      remoteOutput: false,
    },
  },
  "/api/output/devices": {
    selected: "alsa:hw:CARD=USB,DEV=0",
    data: [
      { id: "alsa:hw:CARD=USB,DEV=0", name: "USB DAC", isDefault: false },
      { id: "diretta:target-1", name: "Diretta Target", isDefault: false },
    ],
  },
  "/api/status": {
    state: "playing",
    position: 1_000,
    duration: 180_000,
    volume: 1,
    speed: 1,
    isFinished: false,
  },
  "/api/session": session,
} as const;

const withCoreServer = async (
  callback: (baseUrl: string, requests: Array<{ method: string; path: string }>) => Promise<void>,
): Promise<void> => {
  const requests: Array<{ method: string; path: string }> = [];
  const server = createServer((request, response) => {
    const requestPath = request.url ?? "/";
    requests.push({ method: request.method ?? "GET", path: requestPath });
    response.setHeader("content-type", "application/json");
    if (request.method === "POST") {
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    const data = responses[requestPath as keyof typeof responses];
    if (!data) {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not found" }));
      return;
    }
    response.end(JSON.stringify(data));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    await callback(`http://127.0.0.1:${port}`, requests);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
};

test("hardware diagnostic defaults to read-only Core Protocol requests and sanitizes Track data", () =>
  withCoreServer(async (baseUrl, requests) => {
    const report = await collectHardwareReleaseDiagnostic({
      ...parseHardwareReleaseArgs([]),
      baseUrl,
    });

    assert.equal(report.readOnly, true);
    assert.equal(report.errors.length, 0);
    assert.ok(requests.every((request) => request.method === "GET"));
    assert.deepEqual(
      report.outputs?.data.map((device) => device.kind),
      ["alsa", "diretta"],
    );
    const serialized = JSON.stringify(report);
    assert.doesNotMatch(serialized, /private\/music|private\.example/);
    assert.match(serialized, /Acceptance Track/);
  }));

test("hardware diagnostic mutates output and playback only with explicit validated flags", () =>
  withCoreServer(async (baseUrl, requests) => {
    const report = await collectHardwareReleaseDiagnostic({
      ...parseHardwareReleaseArgs(["--select-output", "diretta:target-1", "--play-pcm-index", "0"]),
      baseUrl,
    });

    assert.equal(report.readOnly, false);
    assert.deepEqual(report.actions, [
      { action: "select-output", target: "diretta:target-1", status: "PASS" },
      { action: "play-queue-index", target: 0, status: "PASS" },
    ]);
    assert.deepEqual(
      requests.filter((request) => request.method === "POST"),
      [
        { method: "POST", path: "/api/output/select" },
        { method: "POST", path: "/api/session/queue/select" },
      ],
    );
  }));

test("hardware diagnostic refuses ambiguous CLI and mismatched Native DSD metadata", async () => {
  assert.throws(
    () => parseHardwareReleaseArgs(["--base-url", "http://user:secret@127.0.0.1:14558"]),
    /不含凭据/,
  );
  assert.throws(
    () => parseHardwareReleaseArgs(["--play-pcm-index", "0", "--play-dsd-index", "1"]),
    /一次只能指定一个/,
  );
  assert.throws(() => parseHardwareReleaseArgs(["--expect-advances", "1"]), /--observe-seconds/);

  await withCoreServer(async (baseUrl, requests) => {
    const report = await collectHardwareReleaseDiagnostic({
      ...parseHardwareReleaseArgs(["--play-dsd-index", "0"]),
      baseUrl,
    });
    assert.equal(report.actions[0]?.status, "FAIL");
    assert.match(report.errors.at(-1)?.message ?? "", /不是预期的 native-dsd/);
    assert.equal(
      requests.some((request) => request.method === "POST"),
      false,
    );
    assert.equal(requests.filter((request) => request.path === "/api/output/devices").length, 1);
  });
});
