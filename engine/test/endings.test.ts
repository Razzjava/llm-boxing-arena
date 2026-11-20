import { describe, expect, it } from "vitest";
import { createFight } from "../src/state.js";
import { resolveExchange } from "../src/exchange.js";
import { endRound } from "../src/round.js";
import { createRng } from "../src/rng.js";
import { runFight } from "../src/fight.js";
import type { FightState } from "../src/types.js";
import { ROUNDS } from "../src/tuning.js";
import { bots, OUT, SLUG, SWARM, demoFight } from "./helpers.js";

const bombs = { actions: ["hook", "uppercut", "cross"] };
const stand = { actions: ["jab", "jab", "jab"] };

/** Try seeds until a resolved exchange matches. */
function findSeed(make: () => FightState, check: (s: FightState) => boolean, planA = stand, planB = bombs): FightState {
  for (let seed = 1; seed < 2000; seed++) {
    const out = resolveExchange(make(), planA, planB, createRng(seed));
    if (check(out.state)) return out.state;
  }
  throw new Error("never happened");
}

describe("every ending is reachable", () => {
  it("KO: a boxer who can't beat the count loses by KO", () => {
    const s = findSeed(
      () => {
        const f = createFight(OUT, SLUG);
        f.a.headHealth = 3;
        f.a.knockdownsTotal = 3;
        return f;
      },
      (st) => st.result?.method === "KO",
    );
    expect(s.result).toMatchObject({ winner: "b", method: "KO" });
  });

  it("TKO: a third knockdown in one round ends it", () => {
    const s = findSeed(
      () => {
        const f = createFight(OUT, SLUG);
        f.a.headHealth = 20;
        f.a.knockdownsRound = 2;
        f.a.knockdownsTotal = 2;
        return f;
      },
      (st) => st.result?.reason === "three knockdowns in one round",
    );
    expect(s.result).toMatchObject({ winner: "b", method: "TKO" });
  });

  it("TKO: the doctor stops a fight for a bad cut from a punch", () => {
    let stopped = false;
    for (let seed = 1; seed < 100 && !stopped; seed++) {
      const f = createFight(OUT, SLUG);
      f.a.cuts = [{ location: "left eyebrow", severity: 5, cause: "punch", openedRound: 1 }];
      const { state, events } = endRound(f, createRng(seed));
      if (state.result) {
        stopped = true;
        expect(state.result).toMatchObject({ winner: "b", method: "TKO" });
        expect(events.some((e) => e.type === "stoppage" && e.by === "doctor")).toBe(true);
      }
    }
    expect(stopped).toBe(true);
  });

  it("TD: an accidental clash cut stopped early is a technical draw", () => {
    for (let seed = 1; seed < 100; seed++) {
      const f = createFight(OUT, SLUG);
      f.a.cuts = [{ location: "forehead", severity: 5, cause: "clash", openedRound: 1 }];
      const { state } = endRound(f, createRng(seed));
      if (state.result) {
        expect(state.result).toMatchObject({ winner: null, method: "TD" });
        return;
      }
    }
    throw new Error("doctor never stopped it");
  });

  it("referee stoppages, KOs and decisions all turn up in real demo fights", async () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 150; seed++) {
      const log = seed % 2 ? await demoFight(seed) : await runFight(SWARM, SLUG, bots.swarmer, bots.slugger, seed);
      seen.add(log.result.method);
      if (log.result.reason.includes("referee")) seen.add("referee");
    }
    for (const m of ["KO", "TKO", "UD", "referee"]) expect(seen).toContain(m);
    expect(["SD", "MD", "draw"].some((m) => seen.has(m))).toBe(true);
  });

  it("a fight that goes the distance lasts 10 rounds and the cards total at most 100", async () => {
    for (let seed = 1; seed < 200; seed++) {
      const log = await runFight(OUT, SWARM, bots.outBoxer, bots.swarmer, seed);
      if (["UD", "SD", "MD", "draw"].includes(log.result.method)) {
        expect(log.rounds).toHaveLength(ROUNDS);
        expect(log.result.round).toBe(ROUNDS);
        for (const c of log.result.scorecards) {
          expect(c.rounds).toHaveLength(ROUNDS);
          expect(c.totalA).toBe(c.rounds.reduce((sum, r) => sum + r.a, 0));
          expect(c.totalB).toBe(c.rounds.reduce((sum, r) => sum + r.b, 0));
          expect(c.totalA).toBeLessThanOrEqual(ROUNDS * 10);
          expect(c.totalB).toBeLessThanOrEqual(ROUNDS * 10);
          expect(c.totalA).toBeGreaterThanOrEqual(ROUNDS * 6);
          expect(c.totalB).toBeGreaterThanOrEqual(ROUNDS * 6);
        }
        expect(log.result.time).toBe(180);
        return;
      }
    }
    throw new Error("no decision found");
  });
});
