import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

const coreStatsSource = read("./headlessPlayStats.ts");
const playerLoadSource = read("./playerLoad.ts");
const directGaplessSource = read("./directGapless.ts");
const nodePlayerSource = read("./corePlayerEvents.ts");
const nodeCoreSource = read("../core-node/index.ts");
const statsTypesSource = read("../../shared/types/stats.ts");
const rendererStatsSource = read("../../src/core/player/stats.ts");
const rendererPlayerSource = read("../../src/core/player/index.ts");
const rendererEventsSource = read("../../src/core/player/events.ts");
const statsClientSource = read("../../src/core/statsClient.ts");
const statsPageSource = read("../../src/pages/Stats.vue");
const continueSource = read("../../src/composables/home/useContinueListening.ts");
const homeHeaderSource = read("../../src/composables/home/useHomeHeader.ts");
const favoriteSource = read("../../src/composables/useFavorite.ts");
const routesSource = read("../atom/headless/routes.ts");

test("Node Core owns the play statistics lifecycle", () => {
  assert.match(coreStatsSource, /insertPlayEvent\(\{ track, startedAt, listenedMs \}\)/);
  assert.match(coreStatsSource, /export const beginCorePlayStats/);
  assert.match(coreStatsSource, /export const onCorePlayerState/);
  assert.match(coreStatsSource, /export const onCorePlayerEnded/);
  assert.doesNotMatch(coreStatsSource, /isHeadlessMode/);

  assert.match(playerLoadSource, /beginCorePlayStats\(/);
  assert.match(directGaplessSource, /beginCorePlayStats\(/);
  assert.match(nodePlayerSource, /onCorePlayerState\(state\)/);
  assert.match(nodePlayerSource, /onCorePlayerEnded\(\)/);
  assert.match(coreStatsSource, /export const shutdownCorePlayStats/);

  assert.doesNotMatch(rendererStatsSource, /Date\.now|window\.api\.stats|watch\(/);
  assert.doesNotMatch(rendererPlayerSource, /installPlayStats/);
  assert.doesNotMatch(rendererEventsSource, /playStats\.onTrackEnded/);
});

test("Control contract cannot write play_history", () => {
  assert.doesNotMatch(statsTypesSource, /recordPlay:/);
  assert.doesNotMatch(statsClientSource, /recordPlay|insertPlayEvent/);
});

test("Web Stats queries and favorite mutation share one Core client", () => {
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

  for (const source of [statsPageSource, continueSource, homeHeaderSource, favoriteSource]) {
    assert.doesNotMatch(source, /window\.api\.stats/);
    assert.match(source, /statsClient/);
  }
});
