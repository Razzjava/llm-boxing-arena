import { describe, expect, it } from "vitest";
import { createFight } from "../src/state.js";
import { resolveExchange } from "../src/exchange.js";
import { createRng } from "../src/rng.js";
import { fatigue } from "../src/stats.js";
import type { FightState } from "../src/types.js";
import { OUT, SLUG } from "./helpers.js";

/** Totals for boxer A over many seeded exchanges. */
function sample(prepare: (s: FightState) => void) {
  let landed = 0;
  let damage = 0;
  let oppLanded = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const s = createFight(SLUG, OUT);
    prepare(s);
    const out = resolveExchange(s, { actions: ["cross", "hook", "cross"] }, { actions: ["jab", "jab", "cross"] }, createRng(seed));
    for (const e of out.events) {
      if (e.type === "land" && e.side === "a") {
        landed++;
        damage += e.damage;
      }
      if (e.type === "land" && e.side === "b") oppLanded++;
    }
  }
  return { landed, damage, perPunch: damage / landed, oppLanded };
}

describe("stamina and fatigue", () => {
  it("a gassed boxer hits softer, lands less and gets hit more", () => {
    const fresh = sample(() => {});
    const tired = sample((s) => {
      s.a.stamina = 2;
    });
    expect(tired.perPunch).toBeLessThan(fresh.perPunch * 0.8);
    expect(tired.landed).toBeLessThan(fresh.landed);
    expect(tired.oppLanded).toBeGreaterThan(fresh.oppLanded);
  });

  it("fatigue only kicks in below half a tank", () => {
    const s = createFight(SLUG, OUT);
    expect(fatigue(s.a)).toBe(1);
    s.a.stamina = s.a.maxStamina * 0.5;
    expect(fatigue(s.a)).toBe(1);
    s.a.stamina = 0;
    expect(fatigue(s.a)).toBe(0.5);
  });

  it("punching costs stamina and body shots drain the other boxer's tank", () => {
    let bodyDrain = 0;
    let headDrain = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const start = createFight(SLUG, OUT);
      const body = resolveExchange(start, { actions: ["body", "body", "body"] }, { actions: ["move"] }, createRng(seed)).state;
      const head = resolveExchange(start, { actions: ["cross", "cross", "cross"] }, { actions: ["move"] }, createRng(seed)).state;
      expect(body.a.stamina).toBeLessThan(start.a.maxStamina);
      bodyDrain += start.b.maxStamina - body.b.stamina;
      headDrain += start.b.maxStamina - head.b.stamina;
    }
    expect(bodyDrain).toBeGreaterThan(headDrain * 1.5);
  });

  it("slipping a straight punch can set up a counter; slipping doesn't stop body shots", () => {
    let counters = 0;
    let bodySlips = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const vsJab = resolveExchange(createFight(SLUG, OUT), { actions: ["jab", "cross"] }, { actions: ["slip"] }, createRng(seed));
      counters += vsJab.events.filter((e) => e.type === "throw" && e.counter && e.side === "b").length;
      const vsBody = resolveExchange(createFight(SLUG, OUT), { actions: ["body"] }, { actions: ["slip"] }, createRng(seed));
      bodySlips += vsBody.events.filter((e) => e.type === "slip").length;
    }
    expect(counters).toBeGreaterThan(50);
    expect(bodySlips).toBe(0);
  });
});
