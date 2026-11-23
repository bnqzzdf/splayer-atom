import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildCoreDiagnosticsSnapshot } from "./diagnostics";

test("buildCoreDiagnosticsSnapshot projects runtime/output state and strips sensitive fields", () => {
  const snapshot = buildCoreDiagnosticsSnapshot({
    generatedAt: "2026-11-23T05:00:00.000Z",
    uptimeSec: 123.4,
    logLevel: { level: "debug", defaultLevel: "info", overridden: true },
    coreInfo: {
      name: "SPlayer Atom",
      version: "2026.11.20",
      commit: "2f2771e0",
      sourceDirty: false,
      platform: "linux",
      arch: "x64",
      node: "24.22.2",
      nodeRange: ">=22.19.0",
      nodeReference: "24.22.2",
      runtime: { name: "node", version: "24.22.2" },
      direttaSdkRelease: 148,
      direttaCpuVariant: "v3",
      protocol: { version: 1 },
      capabilities: {
        library: true,
        playback: true,
        download: true,
        diretta: true,
        remoteOutput: false,
        netease: true,
        qqmusic: true,
        kugou: true,
        qobuz: true,
        tidal: true,
      },
    },
    buildDetails: {
      buildDate: "2026-11-20",
      nodeBundled: true,
      bunBundled: false,
      packaged: true,
    },
    osRelease: "6.6.0-gentoo",
    memory: {
      rssBytes: 95_000_000,
      heapUsedBytes: 25_000_000,
      heapTotalBytes: 40_000_000,
    },
    selectedDeviceId: "upnp:uuid:renderer-1",
    alsaPlaybackMode: "direct",
    playbackStatus: {
      state: "playing",
      position: 12_000,
      duration: 240_000,
      volume: 1,
      speed: 1,
      isFinished: false,
      output: {
        deviceId: "upnp:uuid:renderer-1",
        path: null,
        sampleProcessingAvailable: false,
      },
    },
    playbackSession: {
      active: true,
      mode: "queue",
      queue: [
        {
          track: {
            id: "t1",
            source: "local",
            title: "Private Track",
            artists: [{ id: "a1", name: "Artist" }],
            duration: 240_000,
            path: "/mnt/private/secret-folder/track.flac",
            quality: {
              codec: "FLAC",
              sampleRate: 96000,
              bitsPerSample: 24,
              channels: 2,
              bitRate: 2800,
            },
          },
        },
      ],
      originalQueue: null,
      index: 0,
      current: {
        id: "t1",
        source: "local",
        title: "Private Track",
        artists: [{ id: "a1", name: "Artist" }],
        duration: 240_000,
        path: "/mnt/private/secret-folder/track.flac",
        quality: {
          codec: "FLAC",
          sampleRate: 96000,
          bitsPerSample: 24,
          channels: 2,
          bitRate: 2800,
        },
      },
      repeat: "list",
      shuffle: "off",
    },
    localDevices: [{ id: "alsa:hw:0,0", name: "USB DAC", isDefault: true }],
    cachedUpnpRenderers: [
      {
        id: "upnp:uuid:renderer-1",
        name: "Living Room Renderer",
        avTransportService: "urn:schemas-upnp-org:service:AVTransport:1",
        hasConnectionManager: true,
      },
    ],
    selectedUpnpDeviceId: "upnp:uuid:renderer-1",
    upnpStatus: {
      state: "playing",
      position: 12_000,
      duration: 240_000,
      isFinished: false,
    },
    databaseOpen: true,
    schemaVersion: 7,
    libraryStats: {
      trackCount: 100,
      albumCount: 10,
      artistCount: 20,
      totalDurationMs: 1_000_000,
      totalFileSize: 500_000_000,
      codecs: [{ codec: "FLAC", count: 100 }],
    },
    cacheStats: [
      {
        id: "covers",
        kind: "file",
        path: path.join(os.homedir(), ".cache", "splayer-atom", "covers"),
        size: 1024,
      },
    ],
    providerSessions: {
      netease: { authenticated: true },
      qqmusic: { authenticated: true, userId: "99887766", username: "secret-qm-user" },
      kugou: { authenticated: false },
      qobuz: { authenticated: true, userId: "qobuz-id", username: "secret-qobuz-user" },
      tidal: { authenticated: false },
    },
    streamingConfig: {
      servers: [
        {
          id: "srv-1",
          name: "Home Navidrome",
          type: "navidrome",
          url: "https://secret-user:secret-pass@nas.example.com",
          username: "secret-navidrome-user",
          hasPassword: true,
        },
      ],
      activeServerId: "srv-1",
      connectionStatus: { connected: true },
    },
    plugins: [
      {
        manifest: {
          id: "lx-demo",
          name: "Demo Plugin",
          version: "1.0.0",
        },
        enabled: true,
        status: { state: "ready" },
        settingsValues: { apiKey: "secret-plugin-key" },
      } as never,
    ],
    listenbrainz: {
      enabled: true,
      sendNowPlaying: true,
      linked: true,
      account: "secret-lb-account",
      state: "ready",
      pending: 0,
      dead: 0,
      lastError: "HTTP 401 Authorization: Bearer lb-secret-token",
      processActive: true,
    },
    recentLogs: [
      {
        timestamp: "2026-11-23T05:00:00.000Z",
        level: "info",
        scope: "core",
        message: "ok",
      },
    ],
  });

  assert.equal(snapshot.core.direttaCpuVariant, "v3");
  assert.equal(snapshot.storage.schemaVersion, 7);
  assert.equal(snapshot.output.cachedUpnpRenderers[0]?.name, "Living Room Renderer");
  assert.deepEqual(snapshot.playback.currentTrack, {
    source: "local",
    codec: "FLAC",
    sampleRate: 96000,
    bitsPerSample: 24,
    channels: 2,
    bitRate: 2800,
  });
  assert.deepEqual(snapshot.integrations.streaming, {
    serverCount: 1,
    serverTypes: ["navidrome"],
    hasActiveServer: true,
    connected: true,
    errorCode: null,
  });

  const serialized = JSON.stringify(snapshot);
  if (os.homedir() && os.homedir() !== "/") {
    assert.equal(serialized.includes(os.homedir()), false);
    assert.match(
      snapshot.storage.cache[0]?.path ?? "",
      /^~[\\/]\.cache[\\/]splayer-atom[\\/]covers$/,
    );
  }
  assert.doesNotMatch(
    serialized,
    /Private Track|secret-folder|99887766|secret-qm-user|secret-qobuz-user|secret-pass|secret-navidrome-user|nas\.example\.com|secret-plugin-key|secret-lb-account|lb-secret-token/,
  );
});
