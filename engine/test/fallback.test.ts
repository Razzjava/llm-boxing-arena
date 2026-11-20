import { describe, expect, it } from "vitest";
import { runFight, type Controller } from "../src/fight.js";
import { sanitizeActions } from "../src/plans.js";
import type { FightStateView } from "../src/state.js";
import { bots, OUT, SLUG } from "./helpers.js";

const allPlans = (log: Awaited<ReturnType<typeof runFight>>, side: "a" | "b") => log.rounds.flatMap((r) => r.exchanges.map((x) => x.plans[side]));

describe("bad or missing plans", () => {
  it("junk answers fall back to block + move and the fight still finishes", async () => {
    let i = 0;
    const junk: Controller = () => [undefined, "jab!!", { actions: ["kick", 7] }, { actions: [] }, null][i++ % 5];
    const log = await runFight(OUT, SLUG, junk, bots.slugger, 11);
    expect(log.result).toBeTruthy();
    for (const p of allPlans(log, "a")) {
      expect(p.fallback).toBe(true);
      expect(p.actions).toEqual(["block", "move"]);
    }
    expect(log.rounds.every((r) => r.corner.a.tactic === "box" && r.corner.a.fallback)).toBe(true);
  });

  it("a controller that throws or hangs falls back with the error logged", async () => {
    const thrower: Controller = () => {
      throw new Error("model exploded");
    };
    const hanger: Controller = () => new Promise(() => {});
    const log = await runFight(OUT, SLUG, thrower, hanger, 12, { timeoutMs: 5 });
    expect(allPlans(log, "a")[0]?.error).toBe("model exploded");
    expect(allPlans(log, "b")[0]?.error).toMatch(/no answer within 5ms/);
    expect(allPlans(log, "b").every((p) => p.actions.join() === "block,move")).toBe(true);
  });

  it("keeps the good parts of a partly valid plan and caps it at 3 actions", () => {
    expect(sanitizeActions({ actions: ["JAB", "kick", "body shot", "hook", "uppercut"] }).actions).toEqual(["jab", "body", "hook"]);
  });

  it("controllers see their own side's view and no judges' scores", async () => {
    const seen: FightStateView[] = [];
    const spy: Controller = (view) => {
      seen.push(view);
      return bots.outBoxer(view);
    };
    await runFight(OUT, SLUG, spy, bots.slugger, 13);
    expect(seen.length).toBeGreaterThan(6);
    expect(seen.every((v) => v.you === "a" && v.me.name === OUT.name)).toBe(true);
    expect(JSON.stringify(seen)).not.toMatch(/scorecard|judge/i);
  });
});
