import { describe, expect, it } from "vitest";
import { createFight } from "../src/state.js";
import { decide, scoreRoundForJudge } from "../src/judging.js";
import { createRng } from "../src/rng.js";
import { resolveExchange } from "../src/exchange.js";
import type { FightState, Scorecard } from "../src/types.js";
import { OUT, SLUG } from "./helpers.js";

function roundWhereAOutworkedB(): FightState {
  const s = createFight(OUT, SLUG);
  s.roundStats.a = { thrown: 40, landed: 15, powerLanded: 5, damage: 9, blocked: 4, slipped: 2, counters: 1, knockdownsScored: 0 };
  s.roundStats.b = { thrown: 30, landed: 9, powerLanded: 5, damage: 7, blocked: 2, slipped: 0, counters: 0, knockdownsScored: 0 };
  return s;
}
const biases = ["aggression", "clean punching", "defence"] as const;

describe("judging", () => {
  it("the busier, more accurate boxer wins a normal round 10-9", () => {
    for (const bias of biases) expect(scoreRoundForJudge(roundWhereAOutworkedB(), bias, createRng(1))).toEqual({ a: 10, b: 9 });
  });

  it("a knockdown round is 10-8 for the boxer who scored it", () => {
    const s = roundWhereAOutworkedB();
    s.b.knockdownsRound = 1;
    for (const bias of biases) expect(scoreRoundForJudge(s, bias, createRng(2))).toEqual({ a: 10, b: 8 });
  });

  it("two knockdowns is 10-7", () => {
    const s = roundWhereAOutworkedB();
    s.b.knockdownsRound = 2;
    expect(scoreRoundForJudge(s, "defence", createRng(3))).toEqual({ a: 10, b: 7 });
  });

  it("a knockdown flips a round the downed boxer was otherwise winning to 10-9", () => {
    const s = roundWhereAOutworkedB();
    s.a.knockdownsRound = 1;
    expect(scoreRoundForJudge(s, "clean punching", createRng(4))).toEqual({ a: 9, b: 10 });
  });

  it("a point deduction comes off after the round is scored", () => {
    const s = roundWhereAOutworkedB();
    s.a.deductionsRound = 1;
    expect(scoreRoundForJudge(s, "aggression", createRng(5))).toEqual({ a: 9, b: 9 });
  });

  it("repeated clinching earns a warning, then a deduction", () => {
    let s = createFight(OUT, SLUG);
    const events = [];
    for (let i = 0; i < 4; i++) {
      const out = resolveExchange(s, { actions: ["clinch"] }, { actions: ["jab"] }, createRng(i));
      s = out.state;
      events.push(...out.events);
    }
    expect(events.filter((e) => e.type === "warning")).toHaveLength(1);
    expect(events.filter((e) => e.type === "deduction")).toHaveLength(1);
    expect(s.a.deductionsRound).toBe(1);
    // Punches into a clinch are smothered.
    expect(events.some((e) => e.type === "smothered")).toBe(true);
  });

  const card = (a: number, b: number): Scorecard => ({ judge: "j", bias: "defence", rounds: [], totalA: a, totalB: b });
  it("turns cards into UD, SD, MD and draw", () => {
    expect(decide([card(116, 112), card(115, 113), card(117, 111)])).toMatchObject({ winner: "a", method: "UD" });
    expect(decide([card(115, 113), card(113, 115), card(112, 116)])).toMatchObject({ winner: "b", method: "SD" });
    expect(decide([card(115, 113), card(114, 114), card(115, 113)])).toMatchObject({ winner: "a", method: "MD" });
    expect(decide([card(115, 113), card(113, 115), card(114, 114)])).toMatchObject({ winner: null, method: "draw" });
  });
});
