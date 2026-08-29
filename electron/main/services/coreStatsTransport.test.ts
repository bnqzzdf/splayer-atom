import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

const coreStatsSource = read("./headlessPlayStats.ts");
const playerLoadSource = read("./playerLoad.ts");
const directGaplessSource = read("./directGapless.ts");
const desktopPlayerSource = read("../ipc/player.ts");
const nodePlayerSource = read("./corePlayerEvents.ts");
const desktopCoreSource = read("../core/index.ts");
const nodeCoreSource = read("../core-node/index.ts");
const statsIpcSource = read("../ipc/stats.ts");
const preloadSource = read("../../preload/index.ts");
const statsTypesSource = read("../../../shared/types/stats.ts");
const rendererStatsSource = read("../../../src/core/player/stats.ts");
const rendererPlayerSource = read("../../../src/core/player/index.ts");
const rendererEventsSource = read("../../../src/core/player/events.ts");
const statsClientSource = read("../../../src/core/statsClient.ts");
const webApiSource = read("../../../src/web/api.ts");
const statsPageSource = read("../../../src/pages/Stats.vue");
const continueSource = read("../../../src/composables/home/useContinueListening.ts");
const homeHeaderSource = read("../../../src/composables/home/useHomeHeader.ts");
const favoriteSource = read("../../../src/composables/useFavorite.ts");
const routesSource = read("../atom/headless/routes.ts");

test("Desktop and Node share one Core-owned play statistics lifecycle", () => {
  assert.match(coreStatsSource, /insertPlayEvent\(\{ track, startedAt, listenedMs \}\)/);
  assert.match(coreStatsSource, /export const beginCorePlayStats/);
  assert.match(coreStatsSource, /export const onCorePlayerState/);
  assert.match(coreStatsSource, /export const onCorePlayerEnded/);
  assert.doesNotMatch(coreStatsSource, /isHeadlessMode/);

  assert.match(playerLoadSource, /beginCorePlayStats\(/);
  assert.match(directGaplessSource, /beginCorePlayStats\(/);
  assert.match(desktopPlayerSource, /onCorePlayerState\(state\)/);
  assert.match(desktopPlayerSource, /onCorePlayerEnded\(\)/);
  assert.match(nodePlayerSource, /onCorePlayerState\(state\)/);
  assert.match(nodePlayerSource, /onCorePlayerEnded\(\)/);
  assert.match(coreStatsSource, /export const shutdownCorePlayStats/);
  assert.match(desktopCoreSource, /shutdownCorePlayStats\(\)/);
  assert.match(nodeCoreSource, /corePlayStats\.shutdownCorePlayStats\(\)/);

  assert.doesNotMatch(rendererStatsSource, /Date\.now|window\.api\.stats|watch\(/);
  assert.doesNotMatch(rendererPlayerSource, /installPlayStats/);
  assert.doesNotMatch(rendererEventsSource, /playStats\.onTrackEnded/);
});

test("Control cannot write play_history through a legacy Stats IPC", () => {
  assert.doesNotMatch(statsIpcSource, /stats:recordPlay|insertPlayEvent/);
  assert.doesNotMatch(preloadSource, /stats:recordPlay|recordPlay:/);
  assert.doesNotMatch(statsTypesSource, /recordPlay:/);
});

test("Desktop and Web Stats queries and favorite mutation share one Core client", () => {
  for (const route of [
    "/stats/summary",
    "/stats/library",
    "/stats/top-tracks",
    "/stats/daily",
    "/stats/hourly",
    "/stats/top-albums",
    "/stats/top-artists",
    "/stats/favorite",
  ]) {
    assert.match(routesSource, new RegExp(route.replaceAll("/", "\\/")));
    assert.match(statsClientSource, new RegExp(route.replaceAll("/", "\\/")));
  }

  assert.match(webApiSource, /stats: statsClient/);
  assert.doesNotMatch(webApiSource, /const statsApi:/);
  for (const source of [statsPageSource, continueSource, homeHeaderSource, favoriteSource]) {
    assert.doesNotMatch(source, /window\.api\.stats/);
    assert.match(source, /statsClient/);
  }
});
