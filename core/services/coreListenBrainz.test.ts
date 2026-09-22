import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createPlayProgress } from "./playProgress";

const read = (url: URL): string => readFileSync(url, "utf8");

const serviceSource = read(new URL("./listenbrainz.ts", import.meta.url));
const childSource = read(new URL("./listenbrainzChild.ts", import.meta.url));
const eventsSource = read(new URL("./corePlayerEvents.ts", import.meta.url));
const playerLoadSource = read(new URL("./playerLoad.ts", import.meta.url));
const playbackSessionSource = read(new URL("./playbackSession.ts", import.meta.url));
const directGaplessSource = read(new URL("./directGapless.ts", import.meta.url));
const coreSettingsSource = read(new URL("./coreSettings.ts", import.meta.url));
const routesSource = read(new URL("../atom/headless/routes.ts", import.meta.url));
const coreEntrySource = read(new URL("../core-node/index.ts", import.meta.url));
const settingsTypesSource = read(new URL("../../shared/types/settings.ts", import.meta.url));
const listenbrainzTypesSource = read(
  new URL("../../shared/types/listenbrainz.ts", import.meta.url),
);
const defaultsSource = read(new URL("../../shared/defaults/settings.ts", import.meta.url));
const servicesUiSource = read(
  new URL("../../src/settings/categories/services.ts", import.meta.url),
);
const settingsSchemaSource = read(new URL("../../src/settings/schema.ts", import.meta.url));
const clientSource = read(new URL("../../src/core/listenbrainzClient.ts", import.meta.url));
const coreViteSource = read(new URL("../../scripts/atom/vite.core.config.ts", import.meta.url));
const listenbrainzProcessSource = read(
  new URL("../atom/runtime/listenbrainzProcess.ts", import.meta.url),
);

test("ListenBrainz is runtime-zero while disabled and never joins the position event path", () => {
  assert.match(defaultsSource, /listenbrainz:\s*\{\s*enabled: false,/);
  assert.match(serviceSource, /if \(!isEnabled\(\) \|\| child\) return;/);
  assert.match(serviceSource, /if \(isEnabled\(\)\) startChild\(\);/);
  assert.match(serviceSource, /stopChild\(\);/);
  assert.doesNotMatch(serviceSource, /better-sqlite3|submit-listens/);
  assert.doesNotMatch(eventsSource, /listenbrainz\.onPosition/);
  assert.match(eventsSource, /listenbrainz\.onState\(state === "playing"\)/);
  assert.match(eventsSource, /listenbrainz\.onEnded\(\)/);
});

test("ListenBrainz reuses the authoritative normal and Direct track boundaries", () => {
  assert.match(
    playerLoadSource,
    /listenbrainz\.onTrackLoaded\(authoritative, durationMs, autoPlay\)/,
  );
  assert.match(directGaplessSource, /listenbrainz\.onTrackLoaded\(track, durationMs, true\)/);
  assert.match(serviceSource, /createPlayProgress<ListenSession>/);
  assert.match(serviceSource, /Math\.min\(durationSec \/ 2, 240\) \* 1000/);
  assert.match(serviceSource, /thresholdTimer = setTimeout\([\s\S]*progress\.tick\(\)/);
  assert.doesNotMatch(serviceSource, /rearm\(\)/);
  assert.match(serviceSource, /const invalidateNowPlaying = \(\): void =>/);
  assert.match(serviceSource, /listenbrainz\.sendNowPlaying[\s\S]*invalidateNowPlaying\(\)/);
});

test("same-track Core reloads preserve the current ListenBrainz listen session", () => {
  assert.match(playerLoadSource, /preserveListenBrainzSession\?: boolean/);
  assert.match(
    playerLoadSource,
    /if \(!runtime\.preserveListenBrainzSession\) \{\s*listenbrainz\.onTrackLoaded/,
  );
  assert.match(
    playbackSessionSource,
    /reloadCurrent[\s\S]*loadIndex\(index, false, \{ preserveListenBrainzSession: true \}\)/,
  );
  assert.match(
    playbackSessionSource,
    /sourceRecovery: true,[\s\S]{0,120}preserveListenBrainzSession: true/,
  );
  const outputReloads = playbackSessionSource.match(
    /resolvedOverride: (?:previousResolved|targetResolved)/g,
  );
  const preservedOutputReloads = playbackSessionSource.match(
    /resolvedOverride: (?:previousResolved|targetResolved),\s*preserveListenBrainzSession: true/g,
  );
  assert.ok((outputReloads?.length ?? 0) >= 2);
  assert.equal(preservedOutputReloads?.length, outputReloads?.length);
});

test("ListenBrainz durable I/O and network work live only in the child process", () => {
  assert.match(
    serviceSource,
    /const unackedCaptures = new Map<string, ListenBrainzTrackSnapshot>\(\)/,
  );
  assert.match(serviceSource, /const captureId = randomUUID\(\)/);
  assert.match(serviceSource, /sendPendingCaptures\(\)/);
  assert.match(serviceSource, /unackedCaptures\.delete\(value\.captureId\)/);
  assert.match(serviceSource, /restartTimer = setTimeout/);
  assert.match(serviceSource, /const stopChild[\s\S]*clearRestartTimer\(\)/);
  assert.match(childSource, /from "better-sqlite3"/);
  assert.match(childSource, /capture_id TEXT/);
  assert.match(childSource, /INSERT OR IGNORE INTO listenbrainz_outbox/);
  assert.match(childSource, /sendParent\(\{ type: "captured", captureId: message\.captureId \}\)/);
  assert.match(childSource, /listenbrainz-outbox\.db/);
  assert.match(childSource, /journal_mode = WAL/);
  assert.match(childSource, /synchronous = FULL/);
  assert.match(childSource, /\/submit-listens/);
  assert.match(childSource, /response\.status === 408 \|\| response\.status === 429/);
  assert.match(childSource, /x-ratelimit-reset-in/);
  assert.match(childSource, /state = "auth_error"/);
  assert.match(childSource, /SET state = 'dead'/);
  assert.match(childSource, /latestNowPlaying/);
  assert.doesNotMatch(serviceSource, /new Database\(|fetch\(/);
});

test("ListenBrainz child IPC consumes asynchronous send errors during shutdown races", () => {
  assert.match(listenbrainzProcessSource, /child\.send\(message as any, \(\) => \{\}\)/);
});

test("ListenBrainz child is emitted and initialized by Node Core", () => {
  assert.match(
    coreViteSource,
    /"listenbrainz-child": resolve\(root, "core\/services\/listenbrainzChild\.ts"\)/,
  );
  assert.match(coreEntrySource, /ATOM_LISTENBRAINZ_CHILD_ENTRY/);
  assert.match(coreEntrySource, /listenbrainz\.initListenBrainz\(\)/);
});

test("ListenBrainz settings and Control stay Core-owned and token-free on reads", () => {
  assert.match(settingsTypesSource, /listenbrainz: ListenBrainzSettings/);
  assert.match(settingsTypesSource, /"listenbrainz\."/);
  assert.match(coreSettingsSource, /listenbrainz: store\.get\("listenbrainz"\)/);
  assert.match(coreSettingsSource, /applyListenBrainzSettingChange\(keyPath\)/);
  assert.match(routesSource, /api\.get\("\/listenbrainz\/status"/);
  assert.match(routesSource, /api\.put\("\/listenbrainz\/link"/);
  assert.match(routesSource, /api\.delete\("\/listenbrainz\/link"/);
  assert.match(clientSource, /request<ListenBrainzStatus>\("\/listenbrainz\/status"\)/);
  assert.doesNotMatch(listenbrainzTypesSource, /^\s*token\s*:/im);
});

test("ListenBrainz settings are exposed by Web Control", () => {
  assert.match(servicesUiSource, /id: "listenbrainz"/);
  assert.match(servicesUiSource, /system\.listenbrainz\.enabled/);
  assert.match(servicesUiSource, /system\.listenbrainz\.sendNowPlaying/);
  assert.match(settingsSchemaSource, /import servicesCategory/);
  assert.match(settingsSchemaSource, /controlServicesCategory/);
  assert.doesNotMatch(settingsSchemaSource, /desktopOnlyServiceSections|isDesktopRenderer/);
});

test("disabled runtime spawns no child and disabling an active runtime kills it", async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "splayer-listenbrainz-runtime-"));
  const previousDataDir = process.env.ATOM_DATA_DIR;
  process.env.ATOM_DATA_DIR = dataDir;
  try {
    const [{ configureListenBrainzProcess }, { store }, listenbrainz] = await Promise.all([
      import("../atom/runtime/listenbrainzProcess"),
      import("../store"),
      import("./listenbrainz"),
    ]);

    let spawned = 0;
    let killed = 0;
    configureListenBrainzProcess({
      entry: "fake-listenbrainz-child",
      spawn: () => {
        spawned++;
        let onExit: ((code: number | null) => void) | null = null;
        return {
          stdout: null,
          stderr: null,
          onMessage: () => {},
          onExit: (listener) => {
            onExit = listener;
          },
          send: () => {},
          kill: () => {
            killed++;
            onExit?.(0);
          },
        };
      },
    });

    store.set("listenbrainz.enabled", false);
    listenbrainz.initListenBrainz();
    assert.equal(spawned, 0);
    assert.equal(listenbrainz.getListenBrainzStatus().processActive, false);

    store.set("listenbrainz.enabled", true);
    listenbrainz.applyListenBrainzSettingChange("listenbrainz.enabled");
    assert.equal(spawned, 1);
    assert.equal(listenbrainz.getListenBrainzStatus().processActive, true);

    store.set("listenbrainz.enabled", false);
    listenbrainz.applyListenBrainzSettingChange("listenbrainz.enabled");
    assert.equal(killed, 1);
    assert.equal(listenbrainz.getListenBrainzStatus().processActive, false);
    listenbrainz.shutdownListenBrainz();
  } finally {
    if (previousDataDir === undefined) delete process.env.ATOM_DATA_DIR;
    else process.env.ATOM_DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("createPlayProgress custom threshold counts playing wall-clock but excludes pause time", () => {
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    let fired = 0;
    const progress = createPlayProgress<string>({
      thresholdMs: (durationSec) =>
        durationSec > 0 ? Math.min(durationSec / 2, 240) * 1000 : Infinity,
      onThreshold: () => {
        fired++;
      },
    });

    progress.load(600, "track", true);
    now += 100_000;
    progress.setPlaying(false);
    now += 500_000;
    progress.tick();
    assert.equal(progress.elapsedMs(), 100_000);
    assert.equal(fired, 0);

    progress.setPlaying(true);
    now += 139_999;
    progress.tick();
    assert.equal(fired, 0);
    now += 1;
    progress.tick();
    assert.equal(fired, 1);
    progress.tick();
    assert.equal(fired, 1);
  } finally {
    Date.now = realNow;
  }
});
