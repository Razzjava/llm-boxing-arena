import { describe, expect, it } from "vitest";
import { replayFight, type FightLog } from "../src/fight.js";
import { createFight } from "../src/state.js";
import { resolveExchange } from "../src/exchange.js";
import { createRng } from "../src/rng.js";
import { demoFight, OUT, SLUG } from "./helpers.js";

describe("determinism and replay", () => {
  it("same seed and same controllers give an identical fight", async () => {
    const one = await demoFight(1234);
    const two = await demoFight(1234);
    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
  });

  it("different seeds give different fights", async () => {
    const one = await demoFight(1);
    const two = await demoFight(2);
    expect(JSON.stringify(two.rounds)).not.toBe(JSON.stringify(one.rounds));
  });

  it("a log survives JSON and replays to the identical result", async () => {
    for (const seed of [3, 77, 2026]) {
      const log = await demoFight(seed);
      const loaded = JSON.parse(JSON.stringify(log)) as FightLog;
      const replayed = await replayFight(loaded);
      expect(replayed.result).toEqual(log.result);
      expect(JSON.stringify(replayed)).toBe(JSON.stringify(log));
    }
  });

  it("a saved log still replays when a boxer name would be rejected on a new pick", async () => {
    const log = await demoFight(11);
    const renamed = JSON.parse(JSON.stringify(log)) as FightLog;
    renamed.builds.a.name = "Mike Tyson";
    renamed.finalState.a.build.name = "Mike Tyson";
    const replayed = await replayFight(renamed);
    expect(replayed.result).toEqual(renamed.result);
    expect(replayed.rounds).toEqual(renamed.rounds);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(renamed));
  });

  it("resolveExchange does not mutate the state passed in", () => {
    const state = createFight(OUT, SLUG);
    const before = JSON.stringify(state);
    resolveExchange(state, { actions: ["jab", "cross", "hook"] }, { actions: ["hook", "uppercut"] }, createRng(5));
    expect(JSON.stringify(state)).toBe(before);
  });

  it("events are in time order and every thrown punch is resolved", async () => {
    const log = await demoFight(99);
    for (const r of log.rounds) {
      for (const x of r.exchanges) {
        const times = x.events.map((e) => e.t);
        expect(times).toEqual([...times].sort((p, q) => p - q));
        expect(Math.max(...times)).toBeLessThanOrEqual(x.duration);
        const throws = x.events.filter((e) => e.type === "throw").length;
        const outcomes = x.events.filter((e) => ["land", "block", "slip", "miss"].includes(e.type)).length;
        // A knockdown can cut off punches still in the air, never the other way round.
        expect(outcomes).toBeLessThanOrEqual(throws);
        if (!x.events.some((e) => e.type === "knockdown")) expect(outcomes).toBe(throws);
      }
    }
  });
});
