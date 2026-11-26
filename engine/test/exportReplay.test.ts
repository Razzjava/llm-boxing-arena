import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_BUILDS, DEMO_CONTROLLERS, type DemoStyle } from "../src/controllers.js";
import { ENGINE_VERSION, replayFight, type FightLog } from "../src/fight.js";
import { fought } from "./helpers.js";

describe("engine version", () => {
  it("matches the package version stamped onto exported logs", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(ENGINE_VERSION).toBe(pkg.version);
  });
});

describe("export, parse and replay", () => {
  const cases: { seed: number; red: DemoStyle; blue: DemoStyle }[] = [
    { seed: 11, red: "slugger", blue: "swarmer" },
    { seed: 3, red: "outBoxer", blue: "slugger" },
    { seed: 77, red: "swarmer", blue: "outBoxer" },
    { seed: 2026, red: "slugger", blue: "outBoxer" },
  ];

  it("round-trips a completed fight to the same events and result", async () => {
    for (const c of cases) {
      const log = await fought(DEMO_BUILDS[c.red], DEMO_BUILDS[c.blue], DEMO_CONTROLLERS[c.red], DEMO_CONTROLLERS[c.blue], c.seed);
      const exported = JSON.stringify(log);
      const parsed = JSON.parse(exported) as FightLog;
      const replayed = await replayFight(parsed);
      expect(replayed.result).toEqual(log.result);
      expect(replayed.rounds).toEqual(log.rounds);
      expect(replayed.finalState).toEqual(log.finalState);
      expect(JSON.stringify(replayed)).toBe(exported);
    }
  });

  it("a tampered result is not what the engine replays", async () => {
    const log = await fought(DEMO_BUILDS.slugger, DEMO_BUILDS.swarmer, DEMO_CONTROLLERS.slugger, DEMO_CONTROLLERS.swarmer, 11);
    const parsed = JSON.parse(JSON.stringify(log)) as FightLog;
    parsed.result = { ...parsed.result, winner: parsed.result.winner === "a" ? "b" : "a" };
    const replayed = await replayFight(parsed);
    expect(replayed.result).not.toEqual(parsed.result);
    expect(replayed.rounds).toEqual(log.rounds);
  });
});
