// Knockdowns, the count, and stoppages.
import type { BoxerState, EndMethod, FightEvent, FightState, Punch, Side } from "./types.js";
import type { Rng } from "./rng.js";
import { EXCHANGE_SECONDS, KNOCKDOWN, REFEREE } from "./tuning.js";
import { other } from "./state.js";

export function chinThreshold(b: BoxerState): number {
  return KNOCKDOWN.chinBase + KNOCKDOWN.chinPerStat * b.build.stats.chin;
}

/** Chance a landed shot puts the boxer down. Zero below the chin threshold. */
export function knockdownChance(b: BoxerState, damage: number, sluggerPunch: boolean): number {
  if (b.headHealth <= 0) return 1;
  const missing = (100 - b.headHealth) / 100;
  let shock = damage * (1 + KNOCKDOWN.damageTakenWeight * missing);
  if (b.hurt) shock *= KNOCKDOWN.hurtMultiplier;
  if (sluggerPunch) shock *= KNOCKDOWN.sluggerShock;
  const threshold = chinThreshold(b);
  if (shock <= threshold) return 0;
  return Math.min(KNOCKDOWN.maxChance, KNOCKDOWN.baseChance + (KNOCKDOWN.overThresholdWeight * (shock - threshold)) / threshold);
}

export function getUpChance(b: BoxerState): number {
  const p =
    KNOCKDOWN.getUpBase +
    KNOCKDOWN.getUpPerChin * b.build.stats.chin +
    KNOCKDOWN.getUpStamina * (b.stamina / b.maxStamina) +
    KNOCKDOWN.getUpHealth * (b.headHealth / 100) +
    KNOCKDOWN.getUpPerPriorKnockdown * (b.knockdownsTotal - 1) +
    KNOCKDOWN.getUpPerRoundKnockdown * (b.knockdownsRound - 1) +
    (b.headHealth <= 0 ? KNOCKDOWN.getUpZeroHealth : 0);
  return Math.min(KNOCKDOWN.getUpMax, Math.max(KNOCKDOWN.getUpMin, p));
}

/**
 * Put `side` down at time t, run the count and decide what happens.
 * Returns the time the sequence finished. Sets state.result if the fight ends.
 */
export function knockdown(s: FightState, side: Side, punch: Punch | null, t: number, rng: Rng, events: FightEvent[]): number {
  const b = s[side];
  b.knockdownsRound += 1;
  b.knockdownsTotal += 1;
  s.roundStats[other(side)].knockdownsScored += 1;
  events.push({ t, type: "knockdown", side, punch });

  if (b.knockdownsRound >= KNOCKDOWN.knockdownsForTko) {
    events.push({ t: t + 1, type: "stoppage", side, by: "three knockdowns", reason: "three knockdowns in the round" });
    end(s, other(side), "TKO", t + 1, "three knockdowns in one round");
    return t + 1;
  }

  const getsUp = rng.chance(getUpChance(b));
  if (!getsUp) {
    for (let n = 1; n <= 10; n++) events.push({ t: t + n, type: "count", side, count: n });
    events.push({ t: t + 10.5, type: "counted-out", side });
    end(s, other(side), "KO", t + 10, `counted out after a ${punch ?? "heavy shot"}`);
    return t + 10.5;
  }

  const upAt = rng.int(3, 9);
  const mandatory = Math.max(8, upAt); // the referee always counts to eight
  for (let n = 1; n <= mandatory; n++) {
    events.push({ t: t + n, type: "count", side, count: n });
    if (n === upAt) events.push({ t: t + n + 0.3, type: "get-up", side, count: n });
  }
  b.headHealth = Math.max(b.headHealth, 0) + KNOCKDOWN.recoverHealthOnGetUp;
  b.hurt = true;
  const after = t + mandatory + 0.5;

  if (b.headHealth < REFEREE.stopAfterGetUpHealth && rng.chance(REFEREE.stopAfterGetUpChance)) {
    events.push({ t: after, type: "stoppage", side, by: "referee", reason: "unsteady after the knockdown" });
    end(s, other(side), "TKO", after, "referee waved it off after a knockdown");
  }
  return after;
}

/** Ref steps in during a one-sided exchange. */
export function oneSidedCheck(s: FightState, side: Side, damageTaken: number, t: number, rng: Rng, events: FightEvent[]): void {
  const b = s[side];
  if (damageTaken >= REFEREE.oneSidedDamage && b.headHealth < REFEREE.oneSidedHealth && b.hurt && rng.chance(REFEREE.oneSidedChance)) {
    events.push({ t, type: "stoppage", side, by: "referee", reason: "taking too much punishment" });
    end(s, other(side), "TKO", t, "referee stopped a one-sided beating");
  }
}

export function end(s: FightState, winner: Side | null, method: EndMethod, tInExchange: number, reason: string): void {
  const time = Math.min(180, Math.round((s.exchange - 1) * EXCHANGE_SECONDS + tInExchange));
  s.result = { winner, method, round: s.round, time, reason, scorecards: s.scorecards };
}
